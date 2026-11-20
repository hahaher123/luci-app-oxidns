'use strict';
'require view';
'require rpc';
'require ui';
'require poll';
'require view.oxidns.coresection as coresection';

/*
 * 单页：内核 + 总览 + 服务 + 设置。
 *
 * 2026-11 把原 overview.js 的总览表、服务控制并进本页，并删去与原内核
 * 区块、设置表单重复的字段：
 *   - 总览表不再列 Core（coresection 有 6 行详细状态）；
 *   - 总览表不再列 Config path / Working directory（下方设置表单可编辑）。
 * 保留 Service status：它在总览表里是带色 badge，紧邻服务按钮，与内核
 * 区块里的纯文本状态属于不同上下文。DNS 劫持已拆到独立页面 hijack.js。
 */

var callStatus = rpc.declare({
	object: 'luci.oxidns',
	method: 'status',
	expect: {}
});

var callSettingsRead = rpc.declare({
	object: 'luci.oxidns',
	method: 'settings_read',
	expect: {}
});

var callSettingsSave = rpc.declare({
	object: 'luci.oxidns',
	method: 'settings_save',
	params: [
		'core_repository',
		'core_bundle',
		'config_path',
		'working_dir',
		'download_proxy',
		'github_token',
		'clear_download_proxy',
		'clear_github_token'
	],
	expect: {}
});

var serviceCalls = {
	start: rpc.declare({ object: 'luci.oxidns', method: 'service_start', expect: {} }),
	stop: rpc.declare({ object: 'luci.oxidns', method: 'service_stop', expect: {} }),
	restart: rpc.declare({ object: 'luci.oxidns', method: 'service_restart', expect: {} }),
	enable: rpc.declare({ object: 'luci.oxidns', method: 'service_enable', expect: {} }),
	disable: rpc.declare({ object: 'luci.oxidns', method: 'service_disable', expect: {} })
};

var statusState = {};
var serviceActionsKey = null;

/* ------------------------------------------------------------ 公共小工具 */

function valueOrDash(value) {
	if (value === null || value === undefined || value === '')
		return '-';
	return value;
}

function boolText(value) {
	return value ? _('Yes') : _('No');
}

function serviceRunning(status) {
	return !!(status && status.service_status && status.service_status.running);
}

function serviceEnabled(status) {
	return !!(status && status.service_status && status.service_status.enabled);
}

function coreInstalled(status) {
	return !!(status && status.core && status.core.installed);
}

function statusBadge(text, good) {
	return E('span', {
		'class': good ? 'label label-success' : 'label label-warning'
	}, text);
}

function backendStatusBadge(status) {
	return status && status.ok ? statusBadge(_('Available'), true) : statusBadge(_('Unavailable'), false);
}

function serviceStatusBadge(status) {
	return serviceRunning(status) ? statusBadge(_('Running'), true) : statusBadge(_('Stopped'), false);
}

function setNodeContent(node, value) {
	while (node.firstChild)
		node.removeChild(node.firstChild);

	if (value && value.nodeType)
		node.appendChild(value);
	else
		node.textContent = valueOrDash(value);
}

/* overview 的只读表格行（三参数）与 settings 的可编辑行（两参数）并存 */
function renderRow(label, value, id) {
	var attrs = { 'class': 'td left' };
	if (id)
		attrs.id = id;

	return E('div', { 'class': 'tr' }, [
		E('div', { 'class': 'td left', 'style': 'width: 240px' }, label),
		E('div', attrs, valueOrDash(value))
	]);
}

function field(id) {
	var node = document.getElementById(id);
	return node ? node.value : '';
}

function checked(id) {
	var node = document.getElementById(id);
	return !!(node && node.checked);
}

function row(label, input) {
	return E('div', { 'class': 'tr' }, [
		E('div', { 'class': 'td left', 'style': 'width: 240px' }, label),
		E('div', { 'class': 'td left' }, input)
	]);
}

function textInput(id, value, password, placeholder) {
	return E('input', {
		'id': id,
		'class': 'cbi-input-text',
		'type': password ? 'password' : 'text',
		'value': value || '',
		'placeholder': placeholder || null
	});
}

function option(value, label, selected) {
	return E('option', {
		'value': value,
		'selected': selected ? 'selected' : null
	}, label || value);
}

function bundleSelect(id, value) {
	var selected = value || 'full';
	return E('select', { 'id': id, 'class': 'cbi-input-select' }, [
		option('full', 'full', selected === 'full'),
		option('standard', 'standard', selected === 'standard'),
		option('minimal', 'minimal', selected === 'minimal')
	]);
}

/* ------------------------------------------------------------ 总览 / WebUI */

function localServiceHost(host) {
	return host === 'localhost' ||
		host === '127.0.0.1' ||
		host === '0.0.0.0' ||
		host === '::' ||
		host === '::1' ||
		host === '[::]' ||
		host === '[::1]';
}

function browserWebuiUrl(status) {
	var raw = status && status.webui && status.webui.url;
	if (!raw)
		return '';

	try {
		var url = new URL(raw, window.location.href);
		if (!(status && status.webui && status.webui.local_only) && localServiceHost(url.hostname) && window.location.hostname)
			url.hostname = window.location.hostname;
		url.pathname = url.pathname || '/';
		url.search = '';
		url.hash = '';
		return url.toString();
	} catch (e) {
		return raw;
	}
}

function webuiReady(status) {
	return !!(status && status.webui && status.webui.installed && serviceRunning(status) && browserWebuiUrl(status));
}

function webuiHint(status) {
	if (!status || !status.webui || !status.webui.installed)
		return _('WebUI files are not installed.');
	if (!serviceRunning(status))
		return _('Start the OxiDNS service before opening WebUI.');
	if (status.webui.local_only)
		return _('WebUI listens on loopback only. Configure the HTTP listen address to a LAN-reachable address, or use an SSH tunnel.');
	return '';
}

function webuiButton(status) {
	var url = browserWebuiUrl(status);
	var ready = webuiReady(status);
	var hint = webuiHint(status);

	if (!ready) {
		return E('button', {
			'id': 'oxidns-webui-link',
			'class': 'btn cbi-button cbi-button-neutral',
			'type': 'button',
			'disabled': 'disabled',
			'title': hint
		}, _('Open WebUI'));
	}

	return E('a', {
		'id': 'oxidns-webui-link',
		'class': 'btn cbi-button cbi-button-action',
		'href': url,
		'target': '_blank',
		'rel': 'noopener'
	}, _('Open WebUI'));
}

function webuiEntry(status) {
	var hint = webuiHint(status);

	return E('div', {
		'style': 'display: flex; flex-wrap: wrap; gap: .75em; align-items: center;'
	}, [
		webuiButton(status),
		hint ? E('span', { 'class': 'cbi-value-description' }, hint) : ''
	]);
}

function buildSummary(status) {
	var build = status.build || {};
	if (!build.version)
		return '-';
	return '%s · %s'.format(build.version, build.bundle || 'unknown');
}

/* ------------------------------------------------------------ 服务控制 */

function blockedActionMessage(action, status) {
	if (!coreInstalled(status))
		return _('Install the OxiDNS core before using service controls.');
	if (action === 'start' && serviceRunning(status))
		return _('OxiDNS is already running.');
	if (action === 'stop' && !serviceRunning(status))
		return _('OxiDNS is already stopped.');
	if (action === 'enable' && serviceEnabled(status))
		return _('OxiDNS is already enabled on boot.');
	if (action === 'disable' && !serviceEnabled(status))
		return _('OxiDNS is already disabled on boot.');
	return null;
}

function refreshStatus() {
	return L.resolveDefault(callStatus(), {}).then(function(status) {
		statusState = status || {};

		var fields = {
			'oxidns-backend-status': backendStatusBadge(statusState),
			'oxidns-service-enabled': boolText(statusState.service_status && statusState.service_status.enabled),
			'oxidns-webui': webuiEntry(statusState)
		};

		Object.keys(fields).forEach(function(id) {
			var node = document.getElementById(id);
			if (node)
				setNodeContent(node, fields[id]);
		});

		updateServiceActions(statusState);
	});
}

function handleServiceAction(action) {
	var call = serviceCalls[action];
	if (!call)
		return;

	var blocked = blockedActionMessage(action, statusState);
	if (blocked) {
		ui.addNotification(null, E('p', {}, blocked), 'info');
		return refreshStatus();
	}

	ui.showModal(_('OxiDNS'), [
		E('p', {}, _('Applying service action...'))
	]);

	return L.resolveDefault(call(), null).then(function(result) {
		ui.hideModal();
		if (!result || result.ok === false) {
			ui.addNotification(null, E('p', {}, (result && (result.message || result.error)) || _('Service action failed')), 'danger');
			return;
		}
		return refreshStatus().then(function() {
			ui.addNotification(null, E('p', {}, _('Service action completed.')), 'info');
		});
	}).catch(function(err) {
		ui.hideModal();
		ui.addNotification(null, E('p', {}, err.message || String(err)), 'danger');
	});
}

function actionButton(label, action, style, id) {
	var attrs = {
		'id': id,
		'class': 'btn cbi-button cbi-button-%s'.format(style || 'neutral'),
		'click': function(ev) {
			ev.preventDefault();
			return handleServiceAction(action);
		}
	};

	return E('button', attrs, label);
}

function disabledActionButton(label, hint, id) {
	return E('button', {
		'id': id,
		'class': 'btn cbi-button cbi-button-neutral',
		'type': 'button',
		'disabled': 'disabled',
		'title': hint
	}, label);
}

function serviceActionButtons(status) {
	var actions = [];
	var missingCoreHint = _('Install the OxiDNS core before using service controls.');

	if (!coreInstalled(status)) {
		actions.push(disabledActionButton(_('Start'), missingCoreHint, 'oxidns-service-start'));
		actions.push(disabledActionButton(_('Enable'), missingCoreHint, 'oxidns-service-enable'));
		return actions;
	}

	if (serviceRunning(status)) {
		actions.push(actionButton(_('Stop'), 'stop', 'negative', 'oxidns-service-stop'));
		actions.push(actionButton(_('Restart'), 'restart', 'action', 'oxidns-service-restart'));
	} else {
		actions.push(actionButton(_('Start'), 'start', 'positive', 'oxidns-service-start'));
	}

	if (serviceEnabled(status))
		actions.push(actionButton(_('Disable'), 'disable', 'neutral', 'oxidns-service-disable'));
	else
		actions.push(actionButton(_('Enable'), 'enable', 'positive', 'oxidns-service-enable'));

	return actions;
}

function serviceActionStateKey(status) {
	return '%s:%s:%s'.format(
		coreInstalled(status) ? 'core' : 'missing-core',
		serviceRunning(status) ? 'running' : 'stopped',
		serviceEnabled(status) ? 'enabled' : 'disabled');
}

function updateServiceActions(status) {
	var node = document.getElementById('oxidns-service-actions');
	if (!node)
		return;

	var nextKey = serviceActionStateKey(status);
	if (nextKey === serviceActionsKey)
		return;

	serviceActionsKey = nextKey;
	while (node.firstChild)
		node.removeChild(node.firstChild);

	serviceActionButtons(status).forEach(function(button) {
		node.appendChild(button);
	});
}

function refreshAll() {
	return refreshStatus();
}

/* ------------------------------------------------------------ 设置保存 */

function setStatus(message, danger) {
	var node = document.getElementById('oxidns-settings-status');
	if (!node)
		return;
	node.textContent = message || '';
	node.className = danger ? 'alert-message error' : 'alert-message info';
}

function setDescription(id, message) {
	var node = document.getElementById(id);
	if (node)
		node.textContent = message || '';
}

function setClearOptionVisible(id, visible) {
	var row = document.getElementById('%s-row'.format(id));
	var input = document.getElementById(id);

	if (row)
		row.style.display = visible ? 'block' : 'none';
	if (input)
		input.checked = false;
}

function clearOption(id, label, enabled) {
	return E('label', {
		'id': '%s-row'.format(id),
		'style': 'display: %s; margin-top: .35em;'.format(enabled ? 'block' : 'none')
	}, [
		E('input', {
			'id': id,
			'type': 'checkbox',
			'style': 'margin-right: .5em;'
		}),
		label
	]);
}

function secretSettingInput(input, descriptionId, description, clearId, clearLabel, clearEnabled) {
	return E('div', {}, [
		input,
		E('div', {
			'id': descriptionId,
			'class': 'cbi-value-description'
		}, description),
		clearOption(clearId, clearLabel, clearEnabled)
	]);
}

function proxyDescription() {
	return _('Format: http://host:port, https://host:port, socks5://host:port, or socks5h://host:port. Use http://user:pass@host:port when authentication is required.');
}

function saveSettings() {
	var payload = {
		core_repository: field('oxidns-setting-core-repository') || 'svenshi/oxidns',
		core_bundle: field('oxidns-setting-core-bundle') || 'full',
		config_path: field('oxidns-setting-config-path') || '/etc/oxidns/config.yaml',
		working_dir: field('oxidns-setting-working-dir') || '/var/lib/oxidns',
		download_proxy: field('oxidns-setting-download-proxy'),
		github_token: field('oxidns-setting-github-token'),
		clear_download_proxy: checked('oxidns-setting-clear-download-proxy'),
		clear_github_token: checked('oxidns-setting-clear-github-token')
	};

	ui.showModal(_('OxiDNS'), [
		E('p', {}, _('Saving settings...'))
	]);

	return L.resolveDefault(callSettingsSave(
		payload.core_repository,
		payload.core_bundle,
		payload.config_path,
		payload.working_dir,
		payload.download_proxy,
		payload.github_token,
		payload.clear_download_proxy,
		payload.clear_github_token
	), null).then(function(result) {
		ui.hideModal();
		if (!result || result.ok === false) {
			setStatus((result && (result.message || result.error)) || _('Failed to save settings'), true);
			return;
		}
		setStatus(_('Settings saved.'), false);
		var proxy = document.getElementById('oxidns-setting-download-proxy');
		if (proxy)
			proxy.value = result.download_proxy || '';
		var token = document.getElementById('oxidns-setting-github-token');
		if (token)
			token.value = '';
		var clearProxy = document.getElementById('oxidns-setting-clear-download-proxy');
		if (clearProxy)
			clearProxy.checked = false;
		var clearToken = document.getElementById('oxidns-setting-clear-github-token');
		if (clearToken)
			clearToken.checked = false;
		setClearOptionVisible('oxidns-setting-clear-download-proxy', result.download_proxy_set);
		setClearOptionVisible('oxidns-setting-clear-github-token', result.github_token_set);
		setDescription('oxidns-setting-download-proxy-description', proxyDescription());
		setDescription('oxidns-setting-github-token-description',
			result.github_token_set ? _('A token is currently configured. Enter a new value to replace it.') : _('Optional. The token is never shown after saving.'));
	}).catch(function(err) {
		ui.hideModal();
		setStatus(err.message || String(err), true);
	});
}

/* ------------------------------------------------------------ 区块渲染 */

function overviewRows(status) {
	var rows = [
		renderRow(_('LuCI backend'), backendStatusBadge(status), 'oxidns-backend-status'),
		renderRow(_('Start on boot'), boolText(status.service_status && status.service_status.enabled), 'oxidns-service-enabled'),
		renderRow(_('WebUI'), webuiEntry(status), 'oxidns-webui')
	];

	if (status.error)
		rows.push(renderRow(_('Error'), status.error));

	return rows;
}

function serviceSection(status) {
	return E('div', { 'class': 'cbi-section', 'id': 'oxidns-service-section' }, [
		E('h3', {}, _('Service')),
		E('div', { 'class': 'cbi-section-descr' },
			_('Control the OpenWrt init service for OxiDNS.')),
		E('div', {
			'id': 'oxidns-service-actions',
			'class': 'cbi-button-row',
			'style': 'display: flex; flex-wrap: wrap; gap: .5em;'
		}, serviceActionButtons(status))
	]);
}

function settingsSection(settings) {
	return E('div', { 'class': 'cbi-section', 'id': 'oxidns-settings-section' }, [
		E('h3', {}, _('Settings')),
		E('div', { 'class': 'cbi-section-descr' },
			_('Configure OxiDNS core download sources, runtime paths, and optional download credentials.')),
		E('div', { 'class': 'table cbi-section-table' }, [
			row(_('Core repository'), textInput('oxidns-setting-core-repository', settings.core_repository || 'svenshi/oxidns')),
			row(_('Core bundle'), bundleSelect('oxidns-setting-core-bundle', settings.core_bundle || 'full')),
			row(_('Config path'), textInput('oxidns-setting-config-path', settings.config_path || '/etc/oxidns/config.yaml')),
			row(_('Working directory'), textInput('oxidns-setting-working-dir', settings.working_dir || '/var/lib/oxidns')),
			row(_('Download proxy'), secretSettingInput(
				textInput('oxidns-setting-download-proxy', settings.download_proxy || '', false, _('Example: http://127.0.0.1:7890')),
				'oxidns-setting-download-proxy-description',
				proxyDescription(),
				'oxidns-setting-clear-download-proxy',
				_('Clear configured download proxy'),
				settings.download_proxy_set)),
			row(_('GitHub token'), secretSettingInput(
				textInput('oxidns-setting-github-token', '', true),
				'oxidns-setting-github-token-description',
				settings.github_token_set ? _('A token is currently configured. Enter a new value to replace it.') : _('Optional. The token is never shown after saving.'),
				'oxidns-setting-clear-github-token',
				_('Clear configured GitHub token'),
				settings.github_token_set))
		]),
		E('div', { 'class': 'cbi-button-row' }, [
			E('button', {
				'class': 'btn cbi-button cbi-button-positive',
				'click': function(ev) {
					ev.preventDefault();
					return saveSettings();
				}
			}, _('Save Settings'))
		]),
		E('div', { 'id': 'oxidns-settings-status', 'style': 'margin-top: 1em;' })
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callSettingsRead(), {}),
			L.resolveDefault(callStatus(), {
				ok: false,
				error: _('Unable to query OxiDNS status')
			})
		]).then(function(results) {
			return {
				settings: results[0] || {},
				status: results[1] || {}
			};
		});
	},

	render: function(data) {
		var settings = (data && data.settings) || {};
		var status = (data && data.status) || {};

		statusState = status;
		serviceActionsKey = serviceActionStateKey(statusState);
		poll.add(refreshAll, 5);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('OxiDNS')),
			E('div', { 'class': 'cbi-map-descr' },
				_('Manage the OxiDNS core, service, configuration, and logs from one page.')),
			/* 内核状态 + 概览字段共用一张表，见 coresection.js 的 extraRows */
			coresection.render(status, { extraRows: overviewRows(status) }),
			serviceSection(status),
			settingsSection(settings)
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
