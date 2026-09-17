#!/bin/sh

set -eu

# 用法: release-check.sh [version] [out-dir]
#   version  形如 v0.1.2 或 v0.1.2-r2；留空则读 Makefile 的 PKG_VERSION / PKG_RELEASE
#   out-dir  产物目录，默认 dist
#
# 传入的版本必须与 Makefile 一致，否则直接失败：包版本只有一处事实源
# （Makefile），tag 与它脱节时校验会拿错文件名、把好产物判成坏的。
ARG_VERSION="${1:-${VERSION:-}}"
OUT_DIR="${2:-${OUT_DIR:-dist}}"

MAKEFILE="${PKG_MAKEFILE:-Makefile}"
MK_VERSION="$(sed -n 's/^PKG_VERSION:=//p' "$MAKEFILE" | head -n 1)"
MK_RELEASE="$(sed -n 's/^PKG_RELEASE:=//p' "$MAKEFILE" | head -n 1)"

if [ -n "$ARG_VERSION" ]; then
	PKG_VERSION="$(printf '%s' "$ARG_VERSION" | sed -e 's/^v//' -e 's/-r[0-9][0-9]*$//')"
	PKG_RELEASE="$(printf '%s' "$ARG_VERSION" | sed -n 's/.*-r\([0-9][0-9]*\)$/\1/p')"
	[ -n "$PKG_RELEASE" ] || PKG_RELEASE="$MK_RELEASE"
else
	PKG_VERSION="$MK_VERSION"
	PKG_RELEASE="$MK_RELEASE"
fi

if [ -z "$PKG_VERSION" ] || [ -z "$PKG_RELEASE" ]; then
	printf 'could not determine PKG_VERSION/PKG_RELEASE (version=%s release=%s)\n' \
		"$PKG_VERSION" "$PKG_RELEASE" >&2
	exit 1
fi

if [ "$PKG_VERSION" != "$MK_VERSION" ] || [ "$PKG_RELEASE" != "$MK_RELEASE" ]; then
	printf 'version mismatch: requested %s-r%s, but %s declares %s-r%s\n' \
		"$PKG_VERSION" "$PKG_RELEASE" "$MAKEFILE" "$MK_VERSION" "$MK_RELEASE" >&2
	exit 1
fi

PKG_BASE="luci-app-oxidns_${PKG_VERSION}-r${PKG_RELEASE}_all"
I18N_BASE="luci-i18n-oxidns-zh-cn_${PKG_VERSION}-r${PKG_RELEASE}_all"

need_cmd() {
	command -v "$1" >/dev/null 2>&1 || {
		printf 'required command not found: %s\n' "$1" >&2
		exit 1
	}
}

tar_has_member() {
	tar -tzf "$1" | awk -v member="$2" '
		{
			path = $0;
			sub(/^\.\//, "", path);
			sub(/\/$/, "", path);
			if (path == member)
				found = 1;
		}
		END { exit found ? 0 : 1 }
	'
}

tar_member_contains() {
	tar -xOzf "$1" "$2" 2>/dev/null | grep -q "$3"
}

apk_data_has_checksum() {
	gzip -dc "$1" | grep -q 'APK-TOOLS.checksum.SHA1='
}

tar_nested_has_member() {
	outer="$1"
	inner="$2"
	member="$3"
	nested="$(mktemp "${TMPDIR:-/tmp}/luci-app-oxidns-nested.XXXXXX")"
	if ! tar -xOf "$outer" "$inner" > "$nested" 2>/dev/null &&
		! tar -xOf "$outer" "./$inner" > "$nested" 2>/dev/null; then
		rm -f "$nested"
		return 1
	fi

	if tar -tzf "$nested" | awk -v member="$member" '
		{
			path = $0;
			sub(/^\.\//, "", path);
			if (path == member)
				found = 1;
		}
		END { exit found ? 0 : 1 }
	'; then
		rm -f "$nested"
		return 0
	fi

	rm -f "$nested"
	return 1
}

need_cmd awk
need_cmd gzip
need_cmd grep
need_cmd sha256sum
need_cmd tar

scripts/check.sh
scripts/integration-check.sh
scripts/build-luci-package.sh "$PKG_VERSION" "$OUT_DIR" "$PKG_RELEASE"

tar_has_member "$OUT_DIR/${PKG_BASE}.ipk" control.tar.gz
tar_has_member "$OUT_DIR/${PKG_BASE}.ipk" data.tar.gz
tar_nested_has_member "$OUT_DIR/${PKG_BASE}.ipk" control.tar.gz postinst
tar_nested_has_member "$OUT_DIR/${PKG_BASE}.ipk" control.tar.gz postrm
tar_nested_has_member "$OUT_DIR/${PKG_BASE}.ipk" data.tar.gz etc/init.d/oxidns
tar_has_member "$OUT_DIR/${I18N_BASE}.ipk" control.tar.gz
tar_has_member "$OUT_DIR/${I18N_BASE}.ipk" data.tar.gz
tar_nested_has_member "$OUT_DIR/${I18N_BASE}.ipk" control.tar.gz postinst
tar_has_member "$OUT_DIR/${PKG_BASE}.apk" .PKGINFO
tar_member_contains "$OUT_DIR/${PKG_BASE}.apk" .PKGINFO '^arch = noarch$'
tar_member_contains "$OUT_DIR/${PKG_BASE}.apk" .PKGINFO '^datahash = [0-9a-f][0-9a-f]*$'
apk_data_has_checksum "$OUT_DIR/${PKG_BASE}.apk"
tar_has_member "$OUT_DIR/${PKG_BASE}.apk" etc
tar_has_member "$OUT_DIR/${PKG_BASE}.apk" etc/config
tar_has_member "$OUT_DIR/${PKG_BASE}.apk" usr/share/luci/menu.d
tar_has_member "$OUT_DIR/${PKG_BASE}.apk" www/luci-static/resources/view/oxidns
tar_has_member "$OUT_DIR/${PKG_BASE}.apk" usr/libexec/rpcd/luci.oxidns
tar_has_member "$OUT_DIR/${PKG_BASE}.apk" etc/init.d/oxidns
tar_has_member "$OUT_DIR/${PKG_BASE}.apk" .post-install
tar_has_member "$OUT_DIR/${PKG_BASE}.apk" .post-upgrade
tar_has_member "$OUT_DIR/${PKG_BASE}.apk" .post-deinstall
tar_has_member "$OUT_DIR/${I18N_BASE}.apk" .PKGINFO
tar_member_contains "$OUT_DIR/${I18N_BASE}.apk" .PKGINFO '^arch = noarch$'
tar_member_contains "$OUT_DIR/${I18N_BASE}.apk" .PKGINFO '^datahash = [0-9a-f][0-9a-f]*$'
apk_data_has_checksum "$OUT_DIR/${I18N_BASE}.apk"
tar_has_member "$OUT_DIR/${I18N_BASE}.apk" usr/lib/lua/luci/i18n
tar_has_member "$OUT_DIR/${I18N_BASE}.apk" usr/lib/lua/luci/i18n/oxidns.zh-cn.lmo
tar_has_member "$OUT_DIR/${I18N_BASE}.apk" .post-install
tar_has_member "$OUT_DIR/${I18N_BASE}.apk" .post-upgrade
(cd "$OUT_DIR" && sha256sum -c sha256sums.txt)

printf 'Release check passed for %s-r%s in %s\n' "$PKG_VERSION" "$PKG_RELEASE" "$OUT_DIR"
