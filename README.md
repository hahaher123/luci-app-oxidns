# luci-app-oxidns

语言：中文 | [English](./README.en.md)

> **来源与自用声明**：本仓库是 [svenshi/luci-app-oxidns](https://github.com/svenshi/luci-app-oxidns) 的个人自用分支（fork），仅在自己的路由器上使用；OxiDNS 内核来自 [svenshi/oxidns](https://github.com/svenshi/oxidns)。本分支不发布 Release、不走上游的官方安装脚本、也不保证跟进上游更新，遇到问题请以上游为准；安装方式见下方「构建与安装」。本分支相对上游的改动见文末「本分支的自用改动」。

`luci-app-oxidns` 是 OxiDNS 的 OpenWrt / LuCI 管理插件。安装后，LuCI 会出现 `Services -> OxiDNS` 页面，用来安装 OxiDNS 内核二进制、管理 OpenWrt 服务、编辑配置和查看日志。

这个插件不内置 OxiDNS 内核，也不再管理独立的 OpenWrt `oxidns` 包。LuCI 负责从 OxiDNS 官方 GitHub Releases 下载 release archive，校验 SHA256 digest，并把二进制安装为 OpenWrt 服务。后续 OxiDNS 内核升级由 OxiDNS 自带的升级功能完成，LuCI 不提供内核升级或 LuCI app 自升级按钮。

## 你需要安装什么

- `luci-app-oxidns`：LuCI 管理页面、rpcd 后端和 OpenWrt init 服务脚本。
- `luci-i18n-oxidns-zh-cn`：可选简体中文语言包。

## 构建与安装

本分支自用，不执行上游的官方安装脚本（`https://oxidns.org/install.sh`），也不从上游 Release 下载包：先在本仓库构建，再把包装到路由器。

先构建，需要 `tar`、`gzip`、`node`、`sha256sum`：

```sh
scripts/build-luci-package.sh 0.1.1 dist
```

省略版本号时默认取 `Makefile` 里的 `PKG_VERSION`（当前为 `0.1.1`）。产物写在 `dist/`：`luci-app-oxidns` 和 `luci-i18n-oxidns-zh-cn` 各一份 `.ipk` 和 `.apk`，另有 `sha256sums.txt`。

把 `dist/` 里的包拷到路由器后安装。使用 `apk` 的 OpenWrt 系统：

```sh
apk add --allow-untrusted --no-network ./luci-app-oxidns_0.1.1-r1_all.apk
apk add --allow-untrusted --no-network ./luci-i18n-oxidns-zh-cn_0.1.1-r1_all.apk
```

使用 `opkg` 的 OpenWrt 系统：

```sh
opkg install ./luci-app-oxidns_0.1.1-r1_all.ipk
opkg install ./luci-i18n-oxidns-zh-cn_0.1.1-r1_all.ipk
```

包版本 `0.1.1` 高于上游的 `v0.1.0`，装到已经装过上游包的机器上属于普通升级，不需要 `--force-reinstall`。

如果安装后菜单没有出现，重启 `rpcd`：

```sh
/etc/init.d/rpcd restart
```

然后打开 LuCI：`Services -> OxiDNS`。

## 安装 OxiDNS 内核

如果你是从旧的 OpenWrt `oxidns` 包模式迁移，先停止服务并移除旧内核包，避免它继续拥有 `/usr/bin/oxidns` 或 `/etc/init.d/oxidns`：

```sh
/etc/init.d/oxidns stop
opkg remove oxidns
```

如果系统使用 `apk`，对应执行：

```sh
/etc/init.d/oxidns stop
apk del oxidns
```

1. 打开 `Services -> OxiDNS -> Settings`，确认 `Core repository` 为 `svenshi/oxidns`，`Core bundle` 为 `full`。
2. 打开 `Services -> OxiDNS -> Core`，点击 `Install Core`；离线环境也可以点击 `Upload Core` 上传官方 `.tar.gz` archive 或单个 `oxidns` 二进制。
3. 安装成功后，到 `Overview` 启动并启用服务。

LuCI 会按当前设备 CPU 架构选择 OxiDNS Linux musl release archive，例如 `oxidns-x86_64-unknown-linux-musl.tar.gz`。安装时会校验 GitHub release asset 的 SHA256 digest。

如果内核已经安装，`Core` 页面提供 `Repair Reinstall` 和 `Upload Core`，用于重新下载当前已安装版本或用上传文件修复二进制 / WebUI 文件；它不会安装 latest，也不会作为升级入口。

## 常用页面

- `Overview`：查看内核状态、服务状态、WebUI 入口、配置路径和日志状态。
- `Core`：首次安装、上传安装、修复重装或删除 OxiDNS 内核二进制。
- `Configuration`：查看、保存和校验配置文件。
- `Logs`：查看运行日志，支持刷新和暂停。
- `Settings`：设置 core repository、bundle、代理、配置路径和工作目录。

## 默认路径

- 二进制：`/usr/bin/oxidns`
- WebUI：`/usr/share/oxidns/webui`
- 配置：`/etc/oxidns/config.yaml`
- 工作目录：`/var/lib/oxidns`
- 服务脚本：`/etc/init.d/oxidns`

## 升级与删除

升级 OxiDNS 内核时，请使用 OxiDNS 自带的升级功能，例如内核 WebUI / API / CLI 中的升级能力。LuCI 不提供内核升级入口。

升级 LuCI 插件时，下载新版本 `luci-app-oxidns` 包并重新安装即可。LuCI 页面内不提供自升级。

删除 OxiDNS 内核可以在 LuCI 的 `Core` 页面点击 `Remove Core`。该操作会停止并禁用服务，删除 `/usr/bin/oxidns` 和 `/usr/share/oxidns/webui`，但保留 `/etc/oxidns/config.yaml` 和 `/var/lib/oxidns`。

## 私有仓库与下载

路由器需要能直接访问 GitHub Releases 和 release archive。私有仓库或受限网络环境可以在 `Settings` 中配置 GitHub token 或下载代理。Token 和代理值保存后不会在 LuCI 页面中回显，需要清除时请勾选对应清除选项。配置下载代理时需要安装 `curl`，否则 LuCI 会返回明确错误；也可以在 `Core` 页面手动上传 release archive 或二进制进行离线安装。

## 已知限制

- 目前只支持 OxiDNS 已发布的 Linux musl release target。
- `Core` 页面只负责首次安装、上传安装和修复重装，不负责版本升级。
- `Overview` 的 WebUI 入口根据配置文件中的 HTTP listen 地址生成；如果监听 `127.0.0.1`，LuCI 会保留链接并提示需要本机访问或 SSH 隧道。
- 日志页读取 OpenWrt `logread` 中的 OxiDNS 服务 stdout/stderr 输出。

## 本分支的自用改动

包版本从上游的 `0.1.0` 提升为 `0.1.1`（`Makefile`、CI 工作流与本文档一致），这样构建出来的包版本高于上游的 `v0.1.0`，安装时可以直接覆盖或升级，不需要 `--force-reinstall`。

除版本号外，相对上游只改了配置页的提示显示（`htdocs/luci-static/resources/view/oxidns/config.js` 与 `po/`），目的是让「校验 / 保存」的结果一眼可见：

- 结果面板按状态着色：校验通过（绿）、未生效 / 部分成功（黄）、失败（红）、进行中（灰），每条都有结论标题。
- 结论同时以页面顶部横幅弹出一条 6 秒提示，滚到配置正文上方也能看见。
- 校验过程中按钮禁用、被点的按钮转圈，面板显示「正在校验配置…」，不再只有一个一闪而过的弹窗。
- `oxidns check` 的多行诊断按原样换行显示，并剥掉终端 ANSI 转义。
- 区分 `Save` 与 `Save & Restart`：`Save` 只写文件不生效，提示为黄色「已保存，但未对运行中的服务生效」并说明需要 `Save & Restart`。
- 文件已写入但服务没起来（后端 `service_unavailable` / `service_restart_failed`）时改为黄色「已保存，但服务未重启」，不再笼统报红。
- 校验通过后又改了正文，旧结论会降级为「内容已修改，请重新校验」。
- 保留 RPC 调用失败的真实错误文案（原先会被 `L.resolveDefault()` 吞成 "Operation failed"）。
- 新增文案已同步进 `po/templates/oxidns.pot` 与 `po/zh_Hans/oxidns.po`，可直接 `scripts/build-luci-package.sh` 出包。
