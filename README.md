# luci-app-oxidns

OxiDNS 的 OpenWrt / LuCI 管理插件。安装后 LuCI 出现 `Services -> OxiDNS`，用来安装 OxiDNS 内核、管理服务、编辑配置与规则文件、查看日志。

> **自用声明**：本仓库是 [svenshi/luci-app-oxidns](https://github.com/svenshi/luci-app-oxidns) 的个人自用分支，OxiDNS 内核来自 [svenshi/oxidns](https://github.com/svenshi/oxidns)。只用本仓库 Release 的包，不执行上游的官方安装脚本（`https://oxidns.org/install.sh`），不与上游 Release 混用；不保证跟进上游更新。相对上游的改动见文末。

插件不内置 OxiDNS 内核，也不再管理独立的 `oxidns` 包：LuCI 从 OxiDNS 官方 Release 下载 musl archive、校验 SHA256，装成 OpenWrt 服务。内核升级由 OxiDNS 自带功能完成，LuCI 既不提供内核升级，也不自升级。

## 安装

两个包，都是 `noarch`，与设备架构无关：

- `luci-app-oxidns`：LuCI 页面、rpcd 后端、init 服务脚本
- `luci-i18n-oxidns-zh-cn`：可选简体中文语言包

**1. 取包** —— 从本仓库 Release 下载：

```sh
curl -fsSLO https://github.com/hahaher123/luci-app-oxidns/releases/download/v0.1.4-r4/luci-app-oxidns-0.1.4-r4.apk
curl -fsSLO https://github.com/hahaher123/luci-app-oxidns/releases/download/v0.1.4-r4/luci-i18n-oxidns-zh-cn-0.1.4-r4.apk
```

想固定取最新一版可用 `releases/latest/download/<文件名>`；校验和见 Release 里的 `sha256sums.txt`。

Release 资产是用官方 OpenWrt SDK 编译出的 25.12 `apk`（apk-tools 3 的 ADB 容器格式），与官方 feed 里的包同格式：设备上的 `apk` 能装，ImageBuilder 的 `apk mkndx` / `apk add` 也能索引安装，可以直接拼进自建固件。`opkg` 系统（24.10 及更早）用的 `ipk` 不再随 Release 发布，需要时按下面「自己构建」里的离线方式产出。

Release tag 为 `v<PKG_VERSION>-r<PKG_RELEASE>`，与包文件名里的完整版本号一一对应（如 tag `v0.1.4-r4` ↔ 包 `luci-app-oxidns-0.1.4-r4.apk`）。`v0.1.4-r3` 及更早的资产是本地脚本拼的，文件名形如 `luci-app-oxidns_0.1.4-r3_all.apk`（下划线加 `_all`），命名与现在不同；`v0.1.2` 这类不带 `-r` 的 tag 更早，属旧规则产物。

版本号约定：修 bug / 调整已安装文件只升 `PKG_RELEASE`；新增功能才升 `PKG_VERSION`（同时把 `PKG_RELEASE` 重置为 `1`）；只改文档或 CI 不动版本号。

发布规则：`Makefile` 里的版本号变更推到 `main` 后自动编译并发布 Release，Release 说明取自触发该次发布的 commit 信息（约定 commit 描述本次变动内容）；tag 已存在时自动跳过，不会覆盖。也可在 Actions 手动 dispatch（可显式指定版本）。

**自己构建**有两条路。发布格式（apk-tools 3 的 ADB 容器）只能由官方 SDK 编出来，CI 走的就是这条路（`.github/workflows/build-packages.yml`），本地复现需要 Linux / Docker 环境。

只想在设备上快速试装、不想等 SDK，可以用本地脚本：它不需要 SDK，Windows 上也能跑（需要 `tar`、`gzip`、`node`、`sha256sum`）：

```sh
scripts/build-luci-package.sh '' dist
```

留空参数时默认取 `Makefile` 里的 `PKG_VERSION` / `PKG_RELEASE`，产物写在 `dist/`；也可以显式给版本与修订号：`scripts/build-luci-package.sh 0.1.4 dist 4`。注意这条路产出的是 apk-tools 2.x 风格的包：在设备上 `apk add --allow-untrusted` 装得上，但它**不是**发布格式，也别拿去拼 ImageBuilder 自建固件（过不了 `apk mkndx` 建索引这一关）。

**2. 装到路由器** —— 把包拷上去后：

```sh
apk add --allow-untrusted --no-network ./luci-app-oxidns-0.1.4-r4.apk
apk add --allow-untrusted --no-network ./luci-i18n-oxidns-zh-cn-0.1.4-r4.apk
```

`opkg` 系统（24.10 及更早）用本地脚本产出的 `ipk`：`opkg install ./luci-app-oxidns_0.1.4-r4_all.ipk`。

本分支包版本 `0.1.4` 高于上游 `v0.1.0`，装到已装过上游包的机器上属于普通升级，不需要 `--force-reinstall`。

装完菜单没出现就重启 `rpcd`（`/etc/init.d/rpcd restart`），然后打开 `Services -> OxiDNS`。

**3. 装 OxiDNS 内核** —— 从旧的 `oxidns` 包模式迁移时，先停服务并移除旧包，避免它继续持有 `/usr/bin/oxidns` 和 `/etc/init.d/oxidns`：

```sh
/etc/init.d/oxidns stop
opkg remove oxidns      # apk 系统改用：apk del oxidns
```

然后：

1. `Services -> OxiDNS -> Settings`：确认 `Core repository` 为 `svenshi/oxidns`、`Core bundle` 为 `full`。
2. `Services -> OxiDNS -> Core`：点 `Install Core`；离线环境用 `Upload Core` 上传官方 `.tar.gz` 或单个二进制。
3. 装好后到 `Overview` 启动并启用服务。

LuCI 按设备 CPU 架构选择对应的 musl archive（如 `oxidns-x86_64-unknown-linux-musl.tar.gz`），并校验官方 release asset 的 SHA256。内核已安装时，`Core` 页提供 `Repair Reinstall` / `Upload Core` 用于修复当前版本，不会安装 latest，也不是升级入口。

## 页面

| 页面 | 用途 |
| --- | --- |
| `Overview` | 内核状态、服务状态、WebUI 入口、配置路径、日志状态 |
| `Core` | 安装、上传安装、修复重装、删除内核 |
| `Configuration` | 查看、校验、保存配置文件 |
| `Rule Files` | 编辑 provider 读取的规则列表文件；支持定时重置学习文件（learned-cn / learned-proxy） |
| `Logs` | 运行日志，支持刷新与暂停；「清空」截断日志文件 |
| `Settings` | core repository、bundle、代理、配置路径、工作目录 |

## 默认路径

| 项 | 路径 |
| --- | --- |
| 二进制 | `/usr/bin/oxidns` |
| WebUI | `/usr/share/oxidns/webui` |
| 配置 | `/etc/oxidns/config.yaml` |
| 规则目录 | `/etc/oxidns/rule` |
| 工作目录 | `/var/lib/oxidns` |
| 服务脚本 | `/etc/init.d/oxidns` |

## 升级与删除

- **内核**：用 OxiDNS 自带的升级功能（WebUI / API / CLI），LuCI 不提供内核升级入口。
- **插件**：下载新版本包重新安装即可，页面内不提供自升级。
- **删除内核**：`Core` 页点 `Remove Core`。会停用服务并删除 `/usr/bin/oxidns`、`/usr/share/oxidns/webui`，保留 `/etc/oxidns/config.yaml` 和 `/var/lib/oxidns`。

## 网络受限环境

路由器需要能直接访问 GitHub Releases 和 release archive。私有仓库或受限网络可在 `Settings` 里配置 GitHub token 或下载代理（保存后不回显，清除需勾选对应选项）；配置下载代理需要 `curl`，否则会返回明确错误。也可以在 `Core` 页直接上传 archive 或二进制离线安装。

## 已知限制

- 只支持 OxiDNS 已发布的 Linux musl release target。
- `Core` 页只负责首次安装、上传安装和修复重装，不做版本升级。
- `Overview` 的 WebUI 链接按配置里的 HTTP listen 地址生成；监听 `127.0.0.1` 时 LuCI 保留链接并提示需要本机访问或 SSH 隧道。
- 日志页显示 config.yaml 中 `log.file` 指定的日志文件（未配置时退回 `logread`）；「清空」会截断设备上的日志文件，不会清 syslog。

## 本分支相对上游的改动

包版本 `0.1.0` → `0.1.4`，构建出的包版本高于上游，可直接覆盖升级。文案均已进 `po/`：

1. **新增 `Rule Files` 页** —— 编辑 OxiDNS provider 读取的规则文件（默认目录 `/etc/oxidns/rule`）。页面内用横向标签页切换文件：固定 7 个（白名单、黑名单、灰名单、动态域名、hosts、重定向、本地 ptr），目录里多出来的 `.txt` 以文件名作题注追加在后面；目录里还没有的固定文件照样出标签页（斜体弱化），保存时创建。`Save` 只写盘，`Save & Restart` 才生效，因为 OxiDNS 只在 provider 载入时读这些文件；保存时做 mtime 冲突检测、写前备份（保留最近 10 份）、统一成 LF、沿用原文件权限；只允许目录内的单层 `.txt`。规则目录可用 `uci set oxidns.main.rules_dir=/your/path` 覆盖。
2. **`Rule Files` 页支持定时重置学习文件** —— `learned-cn.txt` / `learned-proxy.txt` 由 OxiDNS 的 `learn_domain` 执行器（`dynamic_domain_set`）自动写入，页面里可分别勾选、按每天 / 每周指定时间定时清空：走 OxiDNS 管理 API 的 `rules/clear`，内存快照与持久化文件同步清理，**无需重启服务**。定时任务写入 cron 托管块（`/etc/crontabs/root` 中 `# BEGIN/END luci-app-oxidns learn-reset`），由后端脚本 `/usr/libexec/oxidns/learn-reset.sh` 执行；管理 API 地址、用户、密码在页面上配置（存 UCI，密码不回显）。也可随时点 `Reset now` 手动清空。
3. **配置页的提示显示** —— 校验 / 保存结果按状态着色（通过绿、未生效黄、失败红、进行中灰）并带结论标题，同时弹一条 6 秒顶部横幅；操作期间按钮禁用、被点的按钮转圈；`oxidns check` 的多行诊断原样换行并剥 ANSI；区分 `Save` 与 `Save & Restart`；文件已写但服务没起来时降级为黄色提示；改了正文后旧结论降级；保留 RPC 失败的真实错误文案。
4. **日志页改为直读日志文件** —— 显示 config.yaml 中 `log.file` 指定的文件内容（相对路径按 OxiDNS 语义基于工作目录展开；未配置 `log.file` 时退回 `logread`），行内 ISO 8601 UTC 时间戳统一换算成 `+08:00` 显示；「清空」通过 rpcd 后端原地截断日志文件（追加写安全，无需重启服务），不再只是清界面。

另外为保证 Windows 上构建出的包也能直接在路由器上用：`.gitattributes` 固定源码为 LF，`scripts/check.sh` 增加行尾守卫（源文件含 CRLF 即失败）。
