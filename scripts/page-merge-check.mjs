#!/usr/bin/env node
/*
 * 「内核页并入设置页」的结构契约。
 *
 * 这些不变量一旦被静默改坏都不会报错（页面照样打开，只是少一块），所以钉住：
 *   1. 菜单只剩 settings 一个主入口（order 10），标题 Core & Settings；
 *      不再有 core / overview 节点，也不再有 core.js / overview.js；
 *      DNS 劫持拆成独立的 hijack 页（order 20）；
 *   2. settings.js require 了 coresection 模块并真的调用 render；
 *   3. coresection 必须返回构造函数（baseclass.extend）—— 返回普通对象会让
 *      LuCI 抛 "factory yields invalid constructor"（2026-11-07 真实踩过）；
 *   4. 六行状态 + 按钮容器的 id 全在；
 *   5. 前端不再有指向旧 core / overview 页的链接；
 *   6. 内核动作所用 RPC 都在 ACL 里。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const failures = [];
const notes = [];
const ok = (m) => notes.push('  ok   ' + m);
const bad = (m) => failures.push(m);

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

/* ---------------------------------------------------------------- 菜单 */

const menu = JSON.parse(read('root/usr/share/luci/menu.d/luci-app-oxidns.json'));
const settingsNode = menu['admin/services/oxidns/settings'];
const coreNode = menu['admin/services/oxidns/core'];
const overviewNode = menu['admin/services/oxidns/overview'];
const hijackNode = menu['admin/services/oxidns/hijack'];

if (coreNode)
	bad('menu.d 里仍存在 admin/services/oxidns/core（内核页应已并入设置页）');

if (overviewNode)
	bad('menu.d 里仍存在 admin/services/oxidns/overview（概览页应已并入设置页）');

if (!hijackNode)
	bad('menu.d 缺少 admin/services/oxidns/hijack（DNS 劫持应独立成页）');
else {
	if (hijackNode.title !== 'DNS Hijack')
		bad(`hijack 菜单标题是「${hijackNode.title}」，期望「DNS Hijack」`);
	if (!hijackNode.action || hijackNode.action.path !== 'oxidns/hijack')
		bad('hijack 菜单 action 不是 view:oxidns/hijack');
}

if (!settingsNode) {
	bad('menu.d 缺少 admin/services/oxidns/settings');
}
else {
	if (settingsNode.title !== 'Core & Settings')
		bad(`settings 菜单标题是「${settingsNode.title}」，期望「Core & Settings」`);

	if (settingsNode.order !== 10)
		bad(`settings 菜单 order 是 ${settingsNode.order}，期望 10（概览页并入后成为首页面）`);

	if (!settingsNode.action || settingsNode.action.type !== 'view' ||
	    settingsNode.action.path !== 'oxidns/settings')
		bad('settings 菜单 action 不是 view:oxidns/settings');

	if (!failures.length)
		ok('菜单已合并为单入口（Core & Settings / order 10，DNS Hijack / order 20）');
}

/* ------------------------------------------------------------ 视图文件 */

if (exists('htdocs/luci-static/resources/view/oxidns/core.js'))
	bad('core.js 仍然存在（应与 coresection.js 二选一）');

if (exists('htdocs/luci-static/resources/view/oxidns/overview.js'))
	bad('overview.js 仍然存在（概览应已并入 settings.js）');

if (!exists('htdocs/luci-static/resources/view/oxidns/hijack.js'))
	bad('缺少 hijack.js（DNS 劫持独立页）');

if (!exists('htdocs/luci-static/resources/view/oxidns/coresection.js'))
	bad('缺少 coresection.js（内核区块模块）');

const settingsSrc = exists('htdocs/luci-static/resources/view/oxidns/settings.js')
	? read('htdocs/luci-static/resources/view/oxidns/settings.js') : '';
const coreSrc = exists('htdocs/luci-static/resources/view/oxidns/coresection.js')
	? read('htdocs/luci-static/resources/view/oxidns/coresection.js') : '';

/* ------------------------------------------------------ 设置页的组装 */

if (!/require view\.oxidns\.coresection as coresection/.test(settingsSrc))
	bad('settings.js 没有 require view.oxidns.coresection');

if (!settingsSrc.includes('coresection.render('))
	bad('settings.js 没有调用 coresection.render()');

/* 内核区块的容器 id 由 coresection 产出，设置区块的由 settings.js 产出 */
if (!coreSrc.includes("'oxidns-core-section'"))
	bad('coresection.js 缺少区块容器 id: oxidns-core-section');

if (!settingsSrc.includes("'oxidns-settings-section'"))
	bad('settings.js 缺少区块容器 id: oxidns-settings-section');

if (!failures.length)
	ok('设置页同时渲染内核与设置两个区块');

/* -------------------------------------------------- 内核模块的必备要素 */

if (!/require baseclass/.test(coreSrc))
	bad('coresection.js 缺少 require baseclass');

if (!/return\s+baseclass\.extend\(/.test(coreSrc))
	bad('coresection.js 没有返回 baseclass.extend(...)，LuCI 会报 factory yields invalid constructor');

if (!/render:\s*render[\s\S]*refresh:\s*refreshStatus/.test(coreSrc))
	bad('coresection.js 没有导出 render / refresh');

for (const id of [
	'oxidns-core-installed', 'oxidns-core-version', 'oxidns-core-bundle',
	'oxidns-core-target', 'oxidns-core-binary', 'oxidns-core-service',
	'oxidns-core-actions'
]) {
	if (!coreSrc.includes(`'${id}'`))
		bad(`coresection.js 缺少元素 id: ${id}`);
}

/* -------------------------------------------------------------- 死链 */

const views = fs.readdirSync(path.join(ROOT, 'htdocs/luci-static/resources/view/oxidns'))
	.filter((f) => f.endsWith('.js'));

for (const f of views) {
	const src = read(path.join('htdocs/luci-static/resources/view/oxidns', f));

	if (src.includes("L.url('admin/services/oxidns/core')"))
		bad(`${f} 仍链接到已删除的 admin/services/oxidns/core`);

	if (src.includes("L.url('admin/services/oxidns/overview')"))
		bad(`${f} 仍链接到已删除的 admin/services/oxidns/overview`);
}

/* -------------------------------------------------- 概览合并 / 劫持拆页 */

const hijackSrc = exists('htdocs/luci-static/resources/view/oxidns/hijack.js')
	? read('htdocs/luci-static/resources/view/oxidns/hijack.js') : '';

for (const block of [ 'overviewSection', 'serviceSection' ]) {
	if (!settingsSrc.includes('function ' + block + '('))
		bad(`settings.js 缺少概览/服务区块: ${block}`);
}

if (settingsSrc.includes('callHijackGet') || settingsSrc.includes('hijack_save') ||
    settingsSrc.includes('function saveHijack') || settingsSrc.includes('hijackSection')) {
	bad('settings.js 仍含 DNS 劫持逻辑（应只在 hijack.js）');
}

for (const token of [ 'hijack_get', 'hijack_save', 'oxidns-hijack-port-mode',
	'oxidns-hijack-apply', 'saveHijack' ]) {
	if (!hijackSrc.includes(token))
		bad(`hijack.js 缺少 DNS 劫持要素: ${token}`);
}

ok('概览/服务已并入 settings，DNS 劫持独立在 hijack.js');

/* ---------------------------------------------------------------- ACL */

const acl = JSON.parse(read('root/usr/share/rpcd/acl.d/luci-app-oxidns.json'));
const granted = new Set();

JSON.stringify(acl, (k, v) => {
	if (Array.isArray(v) && v.every((x) => typeof x === 'string'))
		v.forEach((x) => granted.add(x));
	return v;
});

for (const method of [ 'status', 'settings_read', 'core_install', 'core_update',
	'core_reinstall', 'core_upload_install', 'core_progress', 'core_remove' ]) {
	if (!granted.has(method))
		bad(`ACL 未授予 luci.oxidns ${method}`);
}

/* -------------------------------------------------------------- 输出 */

console.log('内核/设置页面合并检查');

for (const n of notes)
	console.log(n);

if (failures.length) {
	console.log('');
	for (const f of failures)
		console.log('  FAIL ' + f);
	console.log(`\n${failures.length} 条失败`);
	process.exit(1);
}

console.log('\n全部通过');
