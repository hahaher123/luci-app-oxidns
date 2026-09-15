# luci-app-oxidns

Language: [中文](./README.md) | English

> **Source and personal-use notice**: this repository is a personal fork of [svenshi/luci-app-oxidns](https://github.com/svenshi/luci-app-oxidns) used on one home router; the OxiDNS core comes from [svenshi/oxidns](https://github.com/svenshi/oxidns). This fork publishes its own Releases in this repository only, does not use the upstream official installer script, and does not mix with upstream Releases; it does not promise to track upstream and is not affiliated with the upstream author. See "Install" below. The local differences are listed at the end of this file.

`luci-app-oxidns` is the LuCI management app for OxiDNS on OpenWrt. After installation, LuCI adds `Services -> OxiDNS` pages for installing the OxiDNS core binary, managing the OpenWrt service, editing configuration, and viewing logs.

This app does not embed the OxiDNS core binary and no longer manages a separate OpenWrt `oxidns` runtime package. LuCI downloads the official OxiDNS GitHub Release archive, verifies the SHA256 digest, and installs the binary as an OpenWrt service. Future OxiDNS core upgrades are handled by OxiDNS itself; LuCI does not provide core-upgrade or LuCI-app self-upgrade buttons.

## What To Install

- `luci-app-oxidns`: LuCI pages, rpcd backend, and OpenWrt init service script.
- `luci-i18n-oxidns-zh-cn`: optional Simplified Chinese translation package.

## Install

This fork is for personal use and does not run the upstream official installer (`https://oxidns.org/install.sh`). Packages come either from this repository's Release or from a local build.

### From this repository's Release

Release packages are `noarch`, so the device architecture does not matter; there is one `apk` and one `opkg` package, plus `sha256sums.txt`. For `apk` systems:

```sh
curl -fsSLO https://github.com/hahaher123/luci-app-oxidns/releases/download/v0.1.1/luci-app-oxidns_0.1.1-r1_all.apk
curl -fsSLO https://github.com/hahaher123/luci-app-oxidns/releases/download/v0.1.1/luci-i18n-oxidns-zh-cn_0.1.1-r1_all.apk
```

For `opkg` systems use the `.ipk` names. To always take the newest one, use `https://github.com/hahaher123/luci-app-oxidns/releases/latest/download/<name>`.

### Build locally

`tar`, `gzip`, `node`, and `sha256sum` are required:

```sh
scripts/build-luci-package.sh 0.1.1 dist
```

Without an explicit version the script uses `PKG_VERSION` from `Makefile` (currently `0.1.1`). Output goes to `dist/`: one `.ipk` and one `.apk` each for `luci-app-oxidns` and `luci-i18n-oxidns-zh-cn`, plus `sha256sums.txt`.

### Install on the router

Copy the packages to the router and install them there. On OpenWrt systems using `apk`:

```sh
apk add --allow-untrusted --no-network ./luci-app-oxidns_0.1.1-r1_all.apk
apk add --allow-untrusted --no-network ./luci-i18n-oxidns-zh-cn_0.1.1-r1_all.apk
```

On OpenWrt systems using `opkg`:

```sh
opkg install ./luci-app-oxidns_0.1.1-r1_all.ipk
opkg install ./luci-i18n-oxidns-zh-cn_0.1.1-r1_all.ipk
```

Package version `0.1.1` is newer than upstream `v0.1.0`, so installing on a machine that already has the upstream package is a normal upgrade and does not need `--force-reinstall`.

If the menu does not appear after installation, restart `rpcd`:

```sh
/etc/init.d/rpcd restart
```

Then open LuCI: `Services -> OxiDNS`.

## Install OxiDNS Core

If you are migrating from the old OpenWrt `oxidns` package model, stop the service and remove the old runtime package first so it no longer owns `/usr/bin/oxidns` or `/etc/init.d/oxidns`:

```sh
/etc/init.d/oxidns stop
opkg remove oxidns
```

On systems using `apk`, run:

```sh
/etc/init.d/oxidns stop
apk del oxidns
```

1. Open `Services -> OxiDNS -> Settings` and confirm `Core repository` is `svenshi/oxidns` and `Core bundle` is `full`.
2. Open `Services -> OxiDNS -> Core` and click `Install Core`. For offline installs, click `Upload Core` to upload an official `.tar.gz` archive or a single `oxidns` binary.
3. After installation succeeds, use `Overview` to start and enable the service.

LuCI selects the OxiDNS Linux musl release archive for the current CPU architecture, such as `oxidns-x86_64-unknown-linux-musl.tar.gz`. The GitHub release asset SHA256 digest is verified before installation.

When the core is already installed, the `Core` page offers `Repair Reinstall` and `Upload Core`, which repair the binary or WebUI files by downloading the current installed version again or using an uploaded file. It does not install latest and is not an upgrade entry point.

## Main Pages

- `Overview`: core, service, WebUI entry, config path, and log status.
- `Core`: install, upload install, repair reinstall, or remove the OxiDNS core binary.
- `Configuration`: view, save, and validate the config file.
- `Logs`: view runtime logs with refresh and pause controls.
- `Settings`: configure core repository, bundle, proxy, config path, and working directory.

## Default Paths

- Binary: `/usr/bin/oxidns`
- WebUI: `/usr/share/oxidns/webui`
- Config: `/etc/oxidns/config.yaml`
- Working directory: `/var/lib/oxidns`
- Init script: `/etc/init.d/oxidns`

## Upgrade And Remove

To upgrade the OxiDNS core, use the upgrade feature built into OxiDNS itself, such as the core WebUI / API / CLI upgrade flow. LuCI does not provide a core-upgrade entry point.

To upgrade the LuCI app, download and install the newer `luci-app-oxidns` package. The LuCI UI does not provide self-upgrade.

To remove the OxiDNS core, click `Remove Core` on the LuCI `Core` page. This stops and disables the service, removes `/usr/bin/oxidns` and `/usr/share/oxidns/webui`, and preserves `/etc/oxidns/config.yaml` and `/var/lib/oxidns`.

## Private Repositories And Downloads

The router must be able to reach GitHub Releases and release archives directly. For private repositories or restricted networks, configure a GitHub token or download proxy in `Settings`. Token and proxy values are never shown again after saving; use the matching clear option to remove them. A configured download proxy requires `curl`; otherwise LuCI returns a clear error. You can also use `Upload Core` on the `Core` page to install an archive or binary offline.

## Known Limitations

- Only published OxiDNS Linux musl release targets are supported.
- The `Core` page handles first install, upload install, and repair reinstall only, not version upgrades.
- The `Overview` WebUI entry is generated from the HTTP listen address in the config file. If it listens on `127.0.0.1`, LuCI keeps the link and shows a hint that local access or an SSH tunnel is required.
- The log page reads OxiDNS service stdout/stderr output from OpenWrt `logread`.

## Local Changes In This Fork

The package version is bumped from upstream `0.1.0` to `0.1.1` (`Makefile`, CI workflows and this document agree), so the built packages are newer than upstream `v0.1.0` and install as a plain upgrade without `--force-reinstall`.

Apart from the version bump, only the configuration page feedback was changed (`htdocs/luci-static/resources/view/oxidns/config.js` and `po/`), to make validate / save results obvious:

- The result is rendered as a coloured panel (green pass, yellow not-applied/partial, red failure, grey in-progress) with a conclusion headline.
- The same conclusion is also shown as a 6-second banner at the top of the page, so it is visible while scrolled up in the editor.
- While a call is in flight the buttons are disabled, the clicked one spins, and the panel says the operation is running instead of showing a modal that flashes away.
- Multi-line `oxidns check` diagnostics keep their line breaks, and ANSI escapes are stripped.
- `Save` and `Save & Restart` are now distinguishable: plain `Save` only writes the file, so it reports a yellow "saved but not applied to the running service" with a hint to use `Save & Restart`.
- When the file was written but the service failed to restart (rpcd `service_unavailable` / `service_restart_failed`), the result is a yellow "saved, but the service did not restart" instead of a plain red failure.
- Editing the YAML after a successful check downgrades the stale result to "the content changed since it was last checked".
- Real RPC failure messages are preserved (`L.resolveDefault()` used to collapse them into "Operation failed").
- The new strings are added to `po/templates/oxidns.pot` and `po/zh_Hans/oxidns.po`, so `scripts/build-luci-package.sh` still builds the packages.

To keep packages built on Windows usable on the router:

- `.gitattributes` (`* text=auto eol=lf`) makes every checkout LF, whatever the local git settings are.
- `scripts/check.sh` fails when a packaged source contains CRLF, listing the files. With `core.autocrlf=true` the package used to ship CRLF copies of `/usr/libexec/rpcd/luci.oxidns` and `/etc/init.d/oxidns`, whose shebang became `#!/bin/sh\r` and which then did not start on the router.
