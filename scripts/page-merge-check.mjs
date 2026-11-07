#!/usr/bin/env node
/*
 * 「内核页 + 配置页合并成单页」的结构契约。
 *
 * 合并本身很容易在后续改动里被悄悄拆回去：有人再把内核状态搬到独立视图、
 * 有人给某个 id 改名（刷新逻辑按 id 找节点，改名后只是静默不更新），
 * 这些都不报错。所以把不可回退的几点钉住：
 *
 *   1. 菜单里只有一个入口（config），标题是 Core & Configuration，order 20；
 *      不再存在 core 节点，也不再有 core.js；
 *   2. 配置页 require 了 coresection 模块，并在渲染里同时产出两个区块容器；
 *   3. coresection 暴露 render/refresh，且六行状态 + 按钮容器的 id 全在；
 *   4. 整个前端不再有指向旧 core 页的链接；
 *   5. 内核动作所用到的 RPC 方法都在 ACL 里（合并后仍靠同一套方法）。
 *
 *   node scripts/page-merge-check.mjs
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
const configNode = menu['admin/services/oxidns/config'];
const coreNode = menu['admin/services/oxidns/core'];

if (coreNode)
	bad('menu.d 里仍存在 admin/services/oxidns/core（内核页应已并入配置页）');

if (!configNode) {
	bad('menu.d 缺少 admin/services/oxidns/config');
}
else {
	if (configNode.title !== 'Core & Configuration')
		bad(`config 菜单标题是「${configNode.title}」，期望「Core & Configuration」`);

	if (configNode.order !== 20)
		bad(`config 菜单 order 是 ${configNode.order}，期望 20（内核页空出的位置）`);

	if (!configNode.action || configNode.action.type !== 'view' || configNode.action.path !== 'oxidns/config')
		bad('config 菜单 action 不是 view:oxidns/config');

	if (!failures.length)
		ok('菜单已合并为单入口（Core & Configuration / order 20）');
}

/* ------------------------------------------------------------ 视图文件 */

if (exists('htdocs/luci-static/resources/view/oxidns/core.js'))
	bad('core.js 仍然存在（应与 coresection.js 二选一）');

if (!exists('htdocs/luci-static/resources/view/oxidns/coresection.js'))
	bad('缺少 coresection.js（内核区块模块）');

const configSrc = exists('htdocs/luci-static/resources/view/oxidns/config.js')
	? read('htdocs/luci-static/resources/view/oxidns/config.js') : '';
const coreSrc = exists('htdocs/luci-static/resources/view/oxidns/coresection.js')
	? read('htdocs/luci-static/resources/view/oxidns/coresection.js') : '';

/* ------------------------------------------------------ 配置页的组装 */

if (!/require view\.oxidns\.coresection as coresection/.test(configSrc))
	bad('config.js 没有 require view.oxidns.coresection');

if (!configSrc.includes('coresection.render('))
	bad('config.js 没有调用 coresection.render()');

/* 内核区块的容器 id 由 coresection 产出，配置区块的由 config.js 产出 */
if (!coreSrc.includes("'oxidns-core-section'"))
	bad('coresection.js 缺少区块容器 id: oxidns-core-section');

if (!configSrc.includes("'oxidns-config-section'"))
	bad('config.js 缺少区块容器 id: oxidns-config-section');

if (!failures.length)
	ok('配置页同时渲染内核与配置两个区块');

/* -------------------------------------------------- 内核模块的必备要素 */

if (!/return\s*\{[\s\S]*render:\s*render[\s\S]*refresh:\s*refreshStatus/.test(coreSrc))
	bad('coresection.js 没有导出 render / refresh');

for (const id of [
	'oxidns-core-installed', 'oxidns-core-version', 'oxidns-core-bundle',
	'oxidns-core-target', 'oxidns-core-binary', 'oxidns-core-service',
	'oxidns-core-actions'
]) {
	if (!coreSrc.includes(`'${id}'`))
		bad(`coresection.js 缺少元素 id: ${id}`);
}

/* 状态翻转回调必须存在，否则装完内核配置页不会重读 */
if (!coreSrc.includes('onChangeCb'))
	bad('coresection.js 没有 onChange 回调，内核状态变化后配置页不会重读');

/* -------------------------------------------------------------- 死链 */

const views = fs.readdirSync(path.join(ROOT, 'htdocs/luci-static/resources/view/oxidns'))
	.filter((f) => f.endsWith('.js'));

for (const f of views) {
	const src = read(path.join('htdocs/luci-static/resources/view/oxidns', f));

	if (src.includes("oxidns/core'"))
		bad(`${f} 仍链接到已删除的 admin/services/oxidns/core`);
}

/* ---------------------------------------------------------------- ACL */

const acl = JSON.parse(read('root/usr/share/rpcd/acl.d/luci-app-oxidns.json'));
const granted = new Set();

JSON.stringify(acl, (k, v) => {
	if (Array.isArray(v) && v.every((x) => typeof x === 'string'))
		v.forEach((x) => granted.add(x));
	return v;
});

for (const method of [ 'status', 'core_install', 'core_update', 'core_reinstall',
	'core_upload_install', 'core_progress', 'core_remove' ]) {
	if (!granted.has(method))
		bad(`ACL 未授予 luci.oxidns ${method}（内核区块会 403）`);
}

/* -------------------------------------------------------------- 输出 */

console.log('内核/配置页面合并检查');

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
