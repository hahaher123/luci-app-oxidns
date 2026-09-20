#!/usr/bin/env python3
"""校验 OpenWrt 25.12 的 apk 产物是不是 apk-tools 3 的 ADB 容器。

为什么要专门校验格式
--------------------
OpenWrt 25.12 起包格式换成了 apk-tools 3 的 ADB 容器。它和下面两种格式
同名 `.apk`，但互不兼容，混用会让 ImageBuilder 的索引（`apk mkndx`）与
设备上的 `apk add` 直接失败：

  * ipk —— ar 归档，文件头 `!<arch>`
  * apk-tools 2.x 包 —— 双 gzip 流，文件头 `\\x1f\\x8b`

ADB 容器长这样（实测官方 `luci-app-sqm` 与自建 `luci-app-natmap` 一致）::

    41 44 42 2e 70 63 6b 67   "ADB.pckg"   段头
    e4 08 00 00 00 00 00 00   8 字节长度
    d0 08 00 e0               4 字节标志
    0c 6c 75 63 69 2d ...     <单字节长度><字符串> 元数据字段序列
    ...
    (元数据之后是文件条目与文件内容，均为明文)

整段（除前 4 字节）是一整个 raw deflate 流。元数据字段顺序固定为
name / version / description / arch / license / origin / …，本脚本只读前
四个就够了。

用法
----
    check-apk.py 包.apk ...
    check-apk.py --contains etc/init.d/oxidns 包.apk
    check-apk.py --name luci-app-oxidns --arch noarch 包.apk

对每个包校验内容并打印一行 `name=… version=… arch=…`；
任一包不合规即以非 0 退出。`--name` / `--arch` / `--contains` 可重复给出，
作为额外的断言。
"""

import argparse
import os
import sys
import zlib

# 元数据字段顺序（apk-tools 3 的 pkg segment 固定顺序）。
# 只取前四个：再往后对本脚本的用途没有价值，多读反而多一处可能失配的地方。
META_FIELDS = ("name", "version", "description", "arch")

# 段头 8 字节 + 8 字节长度 + 4 字节标志 = 元数据字段起始偏移
_HEAD_LEN = 8
_META_OFFSET = 20


class ApkError(Exception):
    pass


def load_adb_payload(path):
    """读取文件并解出 ADB 段内容。"""
    with open(path, "rb") as fh:
        raw = fh.read()
    if not raw:
        raise ApkError("空文件")

    if raw[:3] != b"ADB":
        head = raw[:16]
        hint = ""
        if raw[:7] == b"!<arch>":
            hint = "（这是 ipk / ar 归档，不是 25.12 的 apk）"
        elif raw[:2] == b"\x1f\x8b":
            hint = "（gzip 流：apk-tools 2.x 的包或 gzip 过的 tar，25.12 不认这种）"
        elif raw[:2] == b"PK":
            hint = "（这是 zip 归档）"
        raise ApkError("不是 ADB 容器%s，文件头 %r" % (hint, head))

    decomp = zlib.decompressobj(-15)
    try:
        payload = decomp.decompress(raw[4:]) + decomp.flush()
    except zlib.error as exc:
        raise ApkError("ADB 段解压失败：%s" % exc)
    if not payload:
        raise ApkError("ADB 段解压后为空")
    return payload


def read_meta(payload):
    """读出元数据头的前四个字段。"""
    if payload[:_HEAD_LEN] != b"ADB.pckg":
        raise ApkError("不是 ADB 的 pckg 段（段头 %r）" % payload[:_HEAD_LEN])

    pos = _META_OFFSET
    meta = {}
    for key in META_FIELDS:
        if pos >= len(payload):
            raise ApkError("元数据被截断，缺少字段 %s" % key)
        size = payload[pos]
        pos += 1
        if size > 0x7F:
            # 本脚本只见过单字节长度；真出现多字节编码说明格式变了，
            # 这时宁可报错也不要按错误的偏移读出一串垃圾。
            raise ApkError("字段 %s 的长度用了多字节编码（首字节 0x%02x），"
                           "格式可能已变，请重新核对" % (key, size))
        meta[key] = payload[pos:pos + size].decode("utf-8", "replace")
        pos += size
    return meta


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="校验 apk 是 apk-tools 3 的 ADB 容器，并断言名称/架构/成员。")
    parser.add_argument("packages", nargs="+", metavar="包.apk")
    parser.add_argument("--name", action="append", default=[],
                        help="断言 pkgname（可重复；每个都要在某个包上命中）")
    parser.add_argument("--arch", action="append", default=[],
                        help="断言 arch（可重复；每个都要在某个包上命中）")
    parser.add_argument("--contains", action="append", default=[],
                        help="断言包内含该路径/字符串（可重复；每个都要在某个包上命中）")
    args = parser.parse_args(argv)

    missing = list(args.name)
    missing_arch = list(args.arch)
    missing_member = list(args.contains)

    failed = False
    for path in args.packages:
        if not os.path.isfile(path):
            print("FAIL %s: 文件不存在" % path)
            failed = True
            continue
        try:
            payload = load_adb_payload(path)
            meta = read_meta(payload)
        except ApkError as exc:
            print("FAIL %s: %s" % (os.path.basename(path), exc))
            failed = True
            continue

        size = os.path.getsize(path)
        print("OK   %-46s %8d B  name=%s version=%s arch=%s"
              % (os.path.basename(path), size,
                 meta["name"], meta["version"], meta["arch"]))

        if meta["name"] in missing:
            missing.remove(meta["name"])
        if meta["arch"] in missing_arch:
            missing_arch.remove(meta["arch"])
        for token in list(missing_member):
            if token.encode("utf-8") in payload:
                missing_member.remove(token)

    if missing:
        print("FAIL 没有任何包提供 pkgname: %s" % ", ".join(missing))
        failed = True
    if missing_arch:
        print("FAIL 没有任何包的 arch 是: %s" % ", ".join(missing_arch))
        failed = True
    if missing_member:
        print("FAIL 任何包里都找不到这些成员: %s" % ", ".join(missing_member))
        failed = True

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
