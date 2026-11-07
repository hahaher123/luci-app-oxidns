#!/usr/bin/env node
/*
 * 合并页面的渲染契约：真的把两个视图跑一遍，检查输出的 DOM 树。
 *
 * 结构检查（page-merge-check.mjs）只能证明"文件里写了什么"，这个脚本证明
 * "渲染出来是什么"：内核区块必须排在配置区块之前、六行状态与按钮容器都在、
 * 编辑器与三个按钮都在；内核未装且配置读不到时只提示安装、不渲染编辑器。
 *
 *   node scripts/page-merge-render.mjs
 */

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEW = path.resolve(HERE, '../htdocs/luci-static/resources/view/oxidns');

const failures = [];

/* ------------------------------------------------------------ DOM 桩 */

function E(tag, attrs, children) {
	const node = {
		tag,
		attrs: attrs || {},
		children: [],
		style: (attrs && attrs.style) || '',
		addEventListener() {},
		appendChild(c) { this.children.push(c); },
		removeChild(c) {
			const i = this.children.indexOf(c);
			if (i >= 0) this.children.splice(i, 1);
		},
		get firstChild() { return this.children[0] || null; },
		get textContent() {
			return this.children.map((c) => (typeof c === 'string' ? c : c.textContent || '')).join('');
		},
		set textContent(v) { this.children = [ String(v) ]; },
		get nodeType() { return 1; },
		classList: { add() {}, remove() {}, toggle() {} }
	};

	if (typeof children === 'string')
		node.children.push(children);
	else if (Array.isArray(children))
		children.forEach((c) => c != null && node.children.push(c));
	else if (children)
		node.children.push(children);

	return node;
}

/* --------------------------------------------------------- 视图加载器 */

function loadView(file, extra) {
	const sandbox = {
		E,
		_: (s) => s,
		L: {
			resolveDefault: (p) => Promise.resolve(p),
			env: {},
			url: (p) => '/' + p
		},
		ui: { addNotification() {}, addTimeLimitedNotification() {}, showModal() {}, hideModal() {} },
		rpc: { declare: () => () => Promise.resolve({}) },
		view: { extend: (o) => o },
		Promise,
		window: { setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, location: { reload() {} }, innerHeight: 900 },
		document: { getElementById: () => null, createElement: () => E('div'), body: {} },
		console,
		...extra
	};

	sandbox.globalThis = sandbox;

	const src = fs.readFileSync(path.join(VIEW, file), 'utf8');

	/* LuCI 用 new Function 包一层，模块顶层才允许 return；这里照做 */
	/* String.prototype.format 是 LuCI 扩展的，真实浏览器里有，这里补上 */
	const polyfill = 'String.prototype.format = function() { var a = arguments, i = 0; '
		+ 'return this.replace(/%[sd]/g, function() { return String(a[i++]); }); };\n';
	return vm.runInNewContext('(function(){\n' + polyfill + src + '\n})()', sandbox, { filename: file });
}

/* 视图里的 'require view.x as y' 只是字符串语句，真正取模块靠这个桩 */
const cmeditorStub = { load: () => Promise.resolve(false), defer() {}, getValue() {}, setValue() {} };
const uploadStub = { uploadText: () => Promise.resolve({}), progressSuffix: () => '' };

const coresection = loadView('coresection.js', {});
const view = loadView('config.js', { cmeditor: cmeditorStub, chunkedUpload: uploadStub, coresection: coresection });

/* ------------------------------------------------------------- 工具 */

function walk(node, fn) {
	if (typeof node === 'string') { fn(node); return; }
	if (!node || typeof node !== 'object') return;
	fn(node);
	(node.children || []).forEach((c) => walk(c, fn));
}

function find(node, pred) {
	let hit = null;
	walk(node, (n) => { if (!hit && pred(n)) hit = n; });
	return hit;
}

function ids(node) {
	const out = [];
	walk(node, (n) => { if (n.attrs && n.attrs.id) out.push(n.attrs.id); });
	return out;
}

function texts(node) {
	const out = [];
	walk(node, (n) => {
		if (typeof n === 'string') out.push(n);
	});
	return out.join(' ');
}

/* --------------------------------------------------------- 场景一：正常 */

const installedStatus = {
	core: { installed: true, version: '1.6.1-r5', bundle: 'full', target: 'x86_64', binary_path: '/usr/bin/oxidns' },
	service_status: { running: true },
	config_path: '/etc/oxidns/config.yaml',
	working_dir: '/var/lib/oxidns'
};

const tree = view.render({
	config: { ok: true, content: 'log:\n  level: info\n', path: '/etc/oxidns/config.yaml' },
	status: installedStatus
});

const allIds = ids(tree);
const required = [
	'oxidns-core-section', 'oxidns-core-installed', 'oxidns-core-version',
	'oxidns-core-bundle', 'oxidns-core-target', 'oxidns-core-binary',
	'oxidns-core-service', 'oxidns-core-actions',
	'oxidns-config-section', 'oxidns-config-content', 'oxidns-config-status'
];

for (const id of required) {
	if (!allIds.includes(id))
		failures.push(`渲染结果缺少 id: ${id}`);
}

/* 内核区块必须在配置区块之前 */
const iCore = allIds.indexOf('oxidns-core-section');
const iCfg = allIds.indexOf('oxidns-config-section');

if (iCore >= 0 && iCfg >= 0 && iCore > iCfg)
	failures.push('内核区块排在配置区块之后（期望先内核、后配置）');

/* 三个配置按钮与编辑器内容 */
const bodyText = texts(tree);

for (const label of [ 'Validate', 'Save', 'Save & Restart' ]) {
	if (!bodyText.includes(label))
		failures.push(`配置按钮缺失: ${label}`);
}

const textarea = find(tree, (n) => n.tag === 'textarea');

if (!textarea)
	failures.push('没有渲染 textarea（编辑器兜底节点）');
else if (textarea.value !== 'log:\n  level: info\n')
	failures.push('textarea 未带上配置文件内容');

/* 内核动作按钮：已装时应为 更新/修复/上传/删除 */
for (const label of [ 'Update Core', 'Repair Reinstall', 'Upload Core', 'Remove Core' ]) {
	if (!bodyText.includes(label))
		failures.push(`已装内核时缺少按钮: ${label}`);
}

/* ------------------------------------------------- 场景二：未装内核 */

const missing = view.render({
	config: { ok: false, message: 'install core first' },
	status: { core: { installed: false }, service_status: { running: false } }
});

const missingIds = ids(missing);
const missingText = texts(missing);

if (!missingIds.includes('oxidns-core-actions'))
	failures.push('未装内核时也要渲染内核动作区（安装按钮在里面）');

if (!missingText.includes('Install Core'))
	failures.push('未装内核时缺少 Install Core 按钮');

if (missingIds.includes('oxidns-config-content'))
	failures.push('未装内核且配置读不到时不应渲染编辑器');

if (!missingText.includes('Install the OxiDNS core before editing the configuration.'))
	failures.push('未装内核时缺少安装提示文案');

/* ------------------------------------------------------------- 输出 */

console.log('内核/配置页面渲染检查');

if (failures.length) {
	for (const f of failures)
		console.log('  FAIL ' + f);
	console.log(`\n${failures.length} 条失败`);
	process.exit(1);
}

console.log(`  ok   两个区块顺序正确，${required.length} 个关键 id 齐全`);
console.log('  ok   已装/未装两种状态下的按钮与提示都正确');
console.log('\n全部通过');
