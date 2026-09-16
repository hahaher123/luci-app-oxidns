'use strict';
'require view';
'require rpc';
'require ui';

var callRulesList = rpc.declare({
	object: 'luci.oxidns',
	method: 'rules_list',
	expect: {}
});

var callRulesRead = rpc.declare({
	object: 'luci.oxidns',
	method: 'rules_read',
	params: [ 'name' ],
	expect: {}
});

var callRulesSave = rpc.declare({
	object: 'luci.oxidns',
	method: 'rules_save',
	params: [ 'name', 'content', 'base_mtime', 'restart' ],
	expect: {}
});

var callStatus = rpc.declare({
	object: 'luci.oxidns',
	method: 'status',
	expect: {}
});

/*
 * 页面状态：
 *   dir     - 规则目录
 *   files   - 目录下可编辑的规则文件
 *   current - 当前正在编辑的文件名
 *   loaded  - 载入 / 保存时的内容快照，用来判断是否有未保存修改
 *   mtime   - 载入时文件在磁盘上的修改时间，保存时用来检测并发改动
 */
var rulesState = {
	dir: '',
	files: [],
	current: null,
	loaded: null,
	mtime: ''
};

var editorState = {
	resultKind: null,
	buttons: []
};

function loadErrorMessage(err) {
	if (err && (err.message || err.error))
		return err.message || err.error;
	return _('Unable to load the rule files.');
}

function readErrorMessage(err) {
	if (err && (err.message || err.error))
		return err.message || err.error;
	return _('Unable to load the rule file.');
}

function textareaValue() {
	var textarea = document.getElementById('oxidns-rules-content');
	return textarea ? textarea.value : '';
}

function selectValue() {
	var select = document.getElementById('oxidns-rules-select');
	return select ? select.value : '';
}

function setSelectValue(name) {
	var select = document.getElementById('oxidns-rules-select');
	if (select)
		select.value = name || '';
}

function coreInstalled(status) {
	return !!(status && status.core && status.core.installed);
}

function formatBytes(size) {
	var value = parseInt(size, 10);

	if (isNaN(value))
		return '-';
	if (value < 1024)
		return '%d B'.format(value);
	if (value < 1024 * 1024)
		return '%.1f KB'.format(value / 1024);
	return '%.1f MB'.format(value / (1024 * 1024));
}

function formatTime(mtime) {
	var value = parseInt(mtime, 10);

	if (isNaN(value) || value <= 0)
		return '-';

	var date = new Date(value * 1000);

	return '%04d-%02d-%02d %02d:%02d:%02d'.format(
		date.getFullYear(), date.getMonth() + 1, date.getDate(),
		date.getHours(), date.getMinutes(), date.getSeconds());
}

function formatCount(value) {
	var count = parseInt(value, 10);
	return isNaN(count) ? '-' : count;
}

function isDirty() {
	return rulesState.loaded !== null && textareaValue() !== rulesState.loaded;
}

/* 去掉命令输出里的 ANSI 转义，避免终端色彩在页面上变成乱码 */
function plainText(value) {
	return String(value === null || value === undefined ? '' : value)
		.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
		.replace(/[ \t]+$/gm, '')
		.replace(/\s+$/, '');
}

function ensureVisible(node) {
	if (!node || !node.getBoundingClientRect)
		return;

	var rect = node.getBoundingClientRect();
	var viewport = window.innerHeight || document.documentElement.clientHeight || 0;

	if (viewport && (rect.bottom > viewport || rect.top < 0))
		node.scrollIntoView({ 'behavior': 'smooth', 'block': 'nearest' });
}

function renderResult(kind, title, detail) {
	var container = document.getElementById('oxidns-rules-status');
	if (!container)
		return;

	while (container.firstChild)
		container.removeChild(container.firstChild);

	var output = plainText(detail);

	if (output && output.toLowerCase() === String(title).toLowerCase())
		output = '';

	var panel = E('div', {
		'class': 'alert-message ' + kind,
		'style': 'margin: .75em 0 0; overflow-wrap: break-word;'
	}, [
		E('h4', {}, title),
		output ? E('pre', {
			'style': 'margin: .35em 0 0; padding: .5em; max-height: 18em; overflow: auto; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.45; background: rgba(0, 0, 0, .06); border: 1px solid rgba(0, 0, 0, .12); border-radius: 3px;'
		}, output) : ''
	]);

	container.appendChild(panel);
	editorState.resultKind = kind;

	window.setTimeout(function() {
		ensureVisible(panel);
	}, 0);
}

function notifyResult(kind, message) {
	if (!message)
		return;

	ui.addTimeLimitedNotification(null, E('p', {}, message), 6000, kind === 'error' ? 'danger' : kind);
}

function setBusy(activeButton, busy) {
	editorState.buttons.forEach(function(button) {
		button.disabled = busy;
		if (busy && button === activeButton)
			button.classList.add('spinning');
		else
			button.classList.remove('spinning');
	});
}

function runRuleCall(button, busyText, call, args) {
	setBusy(button, true);
	renderResult('notice', busyText);

	return Promise.resolve().then(function() {
		return call.apply(null, args || []);
	}).catch(function(err) {
		return {
			ok: false,
			code: 'rpc_error',
			message: (err && err.message) || String(err)
		};
	}).then(function(result) {
		setBusy(button, false);
		return result;
	});
}

function setTextValue(id, value) {
	var node = document.getElementById(id);

	if (node)
		node.textContent = value === null || value === undefined || value === '' ? '-' : value;
}

/* 把单个文件的元信息写进表格行 */
function showFileInfo(file) {
	var info = file || {};
	var known = info.exists !== false;

	setTextValue('oxidns-rules-current', info.name || rulesState.current);
	setTextValue('oxidns-rules-file-size', known ? formatBytes(info.size) : '-');
	setTextValue('oxidns-rules-file-lines', known ? formatCount(info.lines) : '-');
	setTextValue('oxidns-rules-file-mtime', known ? formatTime(info.mtime) : '-');
}

function applyLoadedFile(result) {
	rulesState.current = result.name || rulesState.current;
	rulesState.loaded = result.content || '';
	rulesState.mtime = result.mtime || '';

	setSelectValue(rulesState.current);
	showFileInfo(result);
}

function loadRuleFile(name) {
	if (!name)
		return Promise.resolve(null);

	return runRuleCall(null, _('Loading rule file...'), callRulesRead, [ name ]).then(function(result) {
		if (!result || result.ok === false) {
			renderResult('error', _('Unable to load the rule file'),
				(result && (result.message || result.error)) || readErrorMessage(null));
			notifyResult('error', _('Unable to load the rule file'));
			return null;
		}

		applyLoadedFile(result);

		var textarea = document.getElementById('oxidns-rules-content');
		if (textarea)
			textarea.value = rulesState.loaded;

		renderResult('notice', _('Loaded rule file'), result.path);
		return result;
	});
}

function saveRuleFile(button, restart) {
	var name = selectValue();

	if (!name)
		return Promise.resolve();

	var content = textareaValue();

	return runRuleCall(button, restart ? _('Saving and restarting service...') : _('Saving rule file...'),
		callRulesSave, [ name, content, String(rulesState.mtime || ''), restart ]).then(function(result) {
		var code = result && result.code;
		var message = result && (result.message || result.error);

		if (result && result.ok === false) {
			/* 文件其实已经写进去了，只是服务没起来：不能只报一个红色错误 */
			if (code === 'service_unavailable' || code === 'service_restart_failed') {
				rulesState.loaded = content;
				renderResult('warning', _('Saved, but the service did not restart'), message);
				notifyResult('warning', _('Saved, but the service did not restart'));
				return;
			}

			if (code === 'rule_conflict') {
				renderResult('error', _('Save failed'),
					_('The rule file was modified on disk since it was loaded. Reload it before saving again.'));
				notifyResult('error', _('Save failed'));
				return;
			}

			renderResult('error', _('Save failed'), message);
			notifyResult('error', _('Save failed'));
			return;
		}

		if (result) {
			rulesState.mtime = result.mtime;
			showFileInfo(result);
		}

		rulesState.loaded = content;

		if (restart) {
			renderResult('success', _('Rule file saved and service restarted'), message);
			notifyResult('success', _('Rule file saved and service restarted'));
			return;
		}

		renderResult('warning', _('Saved, but not applied to the running service'),
			_('OxiDNS reads rule files when a provider is loaded. Use Save & Restart to apply the changes.'));
		notifyResult('warning', _('Saved, but not applied to the running service'));
	});
}

/* 载入之后又改了内容：旧结论不再代表当前内容 */
function handleEditorInput() {
	if (editorState.resultKind !== 'success' && editorState.resultKind !== 'warning')
		return;
	if (!isDirty())
		return;

	renderResult('notice', _('There are unsaved changes'));
}

function discardChanges() {
	if (isDirty() && !window.confirm(_('Discard unsaved changes and reload this file?'))) {
		setSelectValue(rulesState.current);
		return Promise.resolve();
	}

	return loadRuleFile(selectValue());
}

function handleFileChange(ev) {
	var name = ev && ev.currentTarget ? ev.currentTarget.value : selectValue();

	if (isDirty() && !window.confirm(_('Discard unsaved changes and load another file?'))) {
		setSelectValue(rulesState.current);
		return;
	}

	return loadRuleFile(name);
}

function ruleSelect(files, current) {
	var options = files.map(function(file) {
		return E('option', {
			'value': file.name,
			'selected': file.name === current ? 'selected' : null
		}, '%s (%s)'.format(file.name, formatBytes(file.size)));
	});

	var select = E('select', {
		'id': 'oxidns-rules-select',
		'class': 'cbi-input-select',
		'style': 'min-width: 320px;'
	}, options);

	select.addEventListener('change', handleFileChange);
	return select;
}

function ruleTextarea(content) {
	var value = content || '';
	var textarea = E('textarea', {
		'id': 'oxidns-rules-content',
		'class': 'cbi-input-textarea',
		'style': 'width: 100%; min-height: 420px; font-family: monospace;',
		'spellcheck': 'false'
	});

	textarea.defaultValue = value;
	textarea.value = value;
	textarea.addEventListener('input', handleEditorInput);
	return textarea;
}

function infoRow(label, id, value) {
	return E('div', { 'class': 'tr' }, [
		E('div', { 'class': 'td left', 'style': 'width: 240px' }, label),
		E('div', { 'class': 'td left', 'id': id }, value)
	]);
}

return view.extend({
	load: function() {
		return L.resolveDefault(callRulesList(), null).then(function(list) {
			return list || {
				ok: false,
				message: _('Unable to load the rule files.')
			};
		}).catch(function(err) {
			return {
				ok: false,
				message: loadErrorMessage(err)
			};
		}).then(function(list) {
			var files = list.files || [];
			var first = files.length ? files[0].name : null;

			/* 首个文件在 load() 里就读出来，render() 才能同步画出编辑器内容 */
			return L.resolveDefault(first ? callRulesRead(first) : null, null).then(function(file) {
				return Promise.all([
					L.resolveDefault(callStatus(), {})
				]).then(function(results) {
					return {
						list: list,
						file: file,
						status: results[0] || {}
					};
				});
			});
		});
	},

	render: function(data) {
		var list = data && data.list ? data.list : {};
		var status = data && data.status ? data.status : {};
		var file = data && data.file ? data.file : null;
		var files = list.files || [];
		var readFailed = list.ok === false;

		rulesState.dir = list.dir || '';
		rulesState.files = files;
		rulesState.current = file && file.ok !== false ? (file.name || null) : null;
		rulesState.loaded = file && file.ok !== false ? (file.content || '') : null;
		rulesState.mtime = file && file.ok !== false ? (file.mtime || '') : '';

		editorState.resultKind = null;

		var header = [
			E('h2', {}, _('OxiDNS Rule Files')),
			E('div', { 'class': 'cbi-map-descr' },
				_('Edit the rule list files that OxiDNS providers read, then restart the service to apply the changes.'))
		];

		var dirRows = [
			infoRow(_('Rule directory'), 'oxidns-rules-dir', rulesState.dir || '-')
		];

		if (readFailed && !coreInstalled(status)) {
			return E('div', { 'class': 'cbi-map' }, header.concat([
				E('div', { 'class': 'cbi-section' }, [
					E('div', { 'class': 'alert-message warning', 'style': 'margin: 1em 0;' },
						_('Install the OxiDNS core before editing the rule files.')),
					E('a', {
						'class': 'btn cbi-button cbi-button-action',
						'href': L.url('admin/services/oxidns/core')
					}, _('Install Core'))
				])
			]));
		}

		if (readFailed || !files.length) {
			return E('div', { 'class': 'cbi-map' }, header.concat([
				E('div', { 'class': 'cbi-section' }, [
					E('div', { 'class': 'alert-message warning', 'style': 'margin: 1em 0;' },
						readFailed
							? (list.message || _('Unable to load the rule files.'))
							: _('No rule files were found in the rule directory.')),
					E('div', { 'class': 'table cbi-section-table' }, dirRows)
				])
			]));
		}

		var loadFailed = !file || file.ok === false;

		var buttons = [
			E('button', {
				'class': 'btn cbi-button cbi-button-positive',
				'click': function(ev) {
					ev.preventDefault();
					return saveRuleFile(ev.currentTarget, false);
				}
			}, _('Save')),
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': function(ev) {
					ev.preventDefault();
					return saveRuleFile(ev.currentTarget, true);
				}
			}, _('Save & Restart')),
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': function(ev) {
					ev.preventDefault();
					return discardChanges();
				}
			}, _('Reload'))
		];

		editorState.buttons = buttons;

		return E('div', { 'class': 'cbi-map' }, header.concat([
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'table cbi-section-table' }, dirRows.concat([
					E('div', { 'class': 'tr' }, [
						E('div', { 'class': 'td left', 'style': 'width: 240px' }, _('Rule file')),
						E('div', { 'class': 'td left' }, [
							ruleSelect(files, rulesState.current),
							E('span', {
								'class': 'cbi-value-description',
								'style': 'display: block; margin-top: .35em;'
							}, _('One rule per line. Lines starting with # are ignored.'))
						])
					]),
					infoRow(_('Editing'), 'oxidns-rules-current',
						loadFailed ? '-' : (rulesState.current || '-')),
					infoRow(_('Size'), 'oxidns-rules-file-size',
						loadFailed ? '-' : formatBytes(file.size)),
					infoRow(_('Lines'), 'oxidns-rules-file-lines',
						loadFailed ? '-' : formatCount(file.lines)),
					infoRow(_('Modified'), 'oxidns-rules-file-mtime',
						loadFailed ? '-' : formatTime(file.mtime))
				])),
				loadFailed ? E('div', {
					'class': 'alert-message warning',
					'style': 'margin: 1em 0;'
				}, (file && (file.message || file.error)) || readErrorMessage(null)) : '',
				ruleTextarea(loadFailed ? '' : (file.content || '')),
				E('div', {
					'class': 'cbi-button-row',
					'style': 'display: flex; flex-wrap: wrap; gap: .5em; margin-top: 1em;'
				}, buttons),
				E('div', { 'id': 'oxidns-rules-status' })
			])
		]));
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
