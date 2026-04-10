(function generalSettingsUiModule(global) {
  const body = global.document?.getElementById?.('generalSettingsPanelBody');
  const settingsPanel = global.MelodySyncSettingsPanel;
  const settingsModel = global.MelodySyncGeneralSettingsModel;

  if (!body || !settingsPanel || !settingsModel) return;

  let loaded = null;
  let pending = false;
  let requestingBrowserNotifications = false;
  let error = '';
  let success = '';

  function escHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function formatVersionLabel(value) {
    const normalized = normalizeText(value).replace(/^v/i, '');
    return normalized ? `v${normalized}` : '';
  }

  async function fetchSettings() {
    body.innerHTML = '<div class="hooks-loading">加载中…</div>';
    try {
      loaded = await settingsModel.fetchSettings();
      pending = false;
      requestingBrowserNotifications = false;
      error = '';
      render();
    } catch (err) {
      body.innerHTML = `<div class="hooks-error">加载失败：${escHtml(err.message)}</div>`;
    }
  }

  function getNamedField(form, name) {
    const field = form?.elements?.namedItem?.(name);
    return typeof field?.value === 'string' ? field.value : '';
  }

  function describeBrowserNotificationState() {
    if (!global?.Notification) {
      return {
        supported: false,
        buttonLabel: '浏览器不支持通知',
        detail: '当前浏览器不支持系统通知。',
      };
    }
    if (global.isSecureContext === false) {
      return {
        supported: false,
        buttonLabel: '需安全连接',
        detail: '当前连接不是安全上下文，手机 Chrome 不会启用浏览器通知。',
      };
    }
    if (!('serviceWorker' in global.navigator) || !('PushManager' in global)) {
      return {
        supported: false,
        buttonLabel: '不支持推送订阅',
        detail: '当前浏览器不支持 Web Push 订阅，手机后台系统通知不会工作。',
      };
    }
    const permission = global.Notification.permission || 'default';
    if (permission === 'granted') {
      return {
        supported: true,
        buttonLabel: '重新订阅浏览器通知',
        detail: '浏览器通知权限已授予，可重新执行一次订阅修复失效订阅。',
      };
    }
    if (permission === 'denied') {
      return {
        supported: false,
        buttonLabel: '通知已被拒绝',
        detail: '浏览器通知权限已被拒绝，需要在浏览器站点设置里重新允许。',
      };
    }
    return {
      supported: true,
      buttonLabel: '开启浏览器通知',
      detail: '建议在手机上手动点一次，Chrome 才会真正弹权限。',
    };
  }

  async function saveSettings(form) {
    if (pending || !form) return;
    pending = true;
    error = '';
    success = '';
    render();
    try {
      const next = await settingsModel.saveSettings({
        brainRoot: getNamedField(form, 'brainRoot').trim(),
        runtimeRoot: getNamedField(form, 'runtimeRoot').trim(),
      });
      loaded = next || loaded;
      success = next?.reloadRequired
        ? (next?.reloadScheduled ? '已保存，服务正在切换新的大脑目录与运行目录。' : '已保存，请重启服务以加载新的大脑目录与运行目录。')
        : '已保存';
      pending = false;
      render();
      if (next?.reloadRequired && next?.reloadScheduled) {
        settingsModel.scheduleReloadAfterConfigSwitch();
      }
    } catch (err) {
      pending = false;
      error = err?.message || '保存失败';
      render();
    }
  }

  async function requestBrowserNotifications() {
    if (pending || requestingBrowserNotifications) return;
    requestingBrowserNotifications = true;
    error = '';
    success = '';
    render();
    try {
      const notificationState = describeBrowserNotificationState();
      if (!notificationState.supported) {
        throw new Error(notificationState.detail);
      }
      const currentPermission = global.Notification.permission || 'default';
      const permission = currentPermission === 'granted'
        ? 'granted'
        : await global.Notification.requestPermission();
      if (permission === 'granted') {
        if (typeof global.setupPushNotifications === 'function') {
          const result = await global.setupPushNotifications();
          if (result?.ok === false) {
            throw new Error(result.error || '浏览器订阅失败');
          }
        }
        success = currentPermission === 'granted'
          ? '浏览器通知订阅已刷新。'
          : '浏览器通知已开启。';
      } else if (permission === 'denied') {
        error = '浏览器通知被拒绝，请到浏览器站点设置里重新允许。';
      } else {
        error = '浏览器通知仍未授权。';
      }
    } catch (err) {
      error = err?.message || '开启浏览器通知失败';
    } finally {
      requestingBrowserNotifications = false;
      render();
    }
  }

  function renderRootCard({ kicker, title, desc, value, extraRows = [], editableName = '', placeholder = '' }) {
    const input = editableName
      ? `
          <label class="general-settings-field">
            <span class="general-settings-field-label">${escHtml(title)}</span>
            <input class="settings-inline-input" form="generalSettingsForm" name="${escHtml(editableName)}" value="${escHtml(value)}" placeholder="${escHtml(placeholder)}">
          </label>
        `
      : '';
    const rows = extraRows
      .filter((entry) => entry && entry.value)
      .map((entry) => `
        <div class="general-settings-path-row">
          <span class="general-settings-path-label">${escHtml(entry.label)}</span>
          <code>${escHtml(entry.value)}</code>
        </div>
      `)
      .join('');
    return `
      <section class="general-settings-card">
        <div class="general-settings-card-head">
          <div>
            <div class="general-settings-card-kicker">${escHtml(kicker)}</div>
            <div class="general-settings-card-title">${escHtml(title)}</div>
          </div>
        </div>
        <div class="general-settings-card-desc">${escHtml(desc)}</div>
        ${input}
        <div class="general-settings-path-list">${rows}</div>
      </section>
    `;
  }

  function render() {
    if (!loaded) return;
    const buildInfo = global.MelodySyncBootstrap?.getBuildInfo?.() || {};
    const brainRoot = loaded.brainRoot || loaded.appRoot || '';
    const runtimeRoot = loaded.runtimeRoot || '';
    const storagePath = loaded.storagePath || '';
    const bootstrapStoragePath = loaded.bootstrapStoragePath || '';
    const agentsPath = loaded.agentsPath || '';
    const machineOverlayRoot = loaded.machineOverlayRoot || '';
    const runtimeConfigRoot = loaded.runtimeConfigRoot || '';
    const memoryPath = loaded.memoryPath || '';
    const sessionsPath = loaded.sessionsPath || '';
    const logsPath = loaded.logsPath || '';
    const providerRuntimeHomesPath = loaded.providerRuntimeHomesPath || '';
    const versionLabel = formatVersionLabel(
      buildInfo.buildVersion
      || buildInfo.serviceBuildVersion
      || buildInfo.serviceVersion
      || buildInfo.version
      || '',
    );
    const buildLabel = normalizeText(buildInfo.serviceLabel || buildInfo.label || '');
    const notificationState = describeBrowserNotificationState();
    const statusRow = error
      ? `<div class="hooks-error">操作失败：${escHtml(error)}</div>`
      : (success ? `<div class="hooks-summary"><div class="hooks-summary-desc">${escHtml(success)}</div></div>` : '');

    body.innerHTML = `
      <div class="hooks-phase-section general-settings-shell">
        <div class="hooks-phase-header">
          <div class="hooks-phase-heading">
            <div class="hooks-phase-title">通用设置</div>
            <div class="hooks-phase-desc">把可迁移的大脑和本机运行体彻底分开，用户才能既拿到长期资产，又不让知识库被运行态污染。</div>
          </div>
        </div>

        <div class="hooks-event-card general-settings-hero">
          <div class="general-settings-hero-title">当前存储拓扑</div>
          <div class="general-settings-hero-desc">长期记忆跟着你走，运行数据留在本机，设备配置只属于当前机器。</div>
          <div class="general-settings-topology">
            <div class="general-settings-topology-node">
              <span class="general-settings-topology-kicker">Brain</span>
              <strong>00-🤖agent</strong>
              <span>长期记忆、规则、项目资产</span>
            </div>
            <div class="general-settings-topology-arrow">→</div>
            <div class="general-settings-topology-node">
              <span class="general-settings-topology-kicker">Runtime</span>
              <strong>本机运行体</strong>
              <span>sessions、logs、provider capture</span>
            </div>
            <div class="general-settings-topology-arrow">→</div>
            <div class="general-settings-topology-node">
              <span class="general-settings-topology-kicker">Device</span>
              <strong>当前设备配置</strong>
              <span>auth、tools、push、启动配置</span>
            </div>
          </div>
        </div>

        <div class="general-settings-grid">
          ${renderRootCard({
            kicker: 'Portable Brain',
            title: '大脑目录',
            desc: '这个目录可以放进同步盘或知识库，承载长期记忆、规则和项目背景。',
            value: brainRoot,
            editableName: 'brainRoot',
            placeholder: '/Users/xxx/diary/diary/00-🤖agent',
            extraRows: [
              { label: '说明文件', value: agentsPath },
              { label: '记忆目录', value: memoryPath },
            ],
          })}
          ${renderRootCard({
            kicker: 'Local Runtime',
            title: '运行目录',
            desc: '这一层承载本机运行态，优先保证能力、恢复和读取速度，不默认进入知识库。',
            value: runtimeRoot,
            editableName: 'runtimeRoot',
            placeholder: '/Users/xxx/.melodysync/runtime',
            extraRows: [
              { label: '运行态配置', value: runtimeConfigRoot },
              { label: '会话目录', value: sessionsPath },
              { label: '日志目录', value: logsPath },
              { label: 'Provider 运行目录', value: providerRuntimeHomesPath },
            ],
          })}
          ${renderRootCard({
            kicker: 'Current Device',
            title: '设备配置层',
            desc: '只属于当前机器，不跟着大脑跨机器移动。',
            value: machineOverlayRoot,
            extraRows: [
              { label: '当前版本', value: versionLabel },
              { label: '构建标识', value: buildLabel && buildLabel !== versionLabel ? buildLabel : '' },
              { label: '当前设备配置文件', value: bootstrapStoragePath },
              { label: '运行态设置文件', value: storagePath },
            ],
          })}
        </div>

        <div class="hooks-event-card">
          <form id="generalSettingsForm" data-general-settings-form class="general-settings-form">
            <div class="task-map-node-section">
              <div class="task-map-node-section-title">保存规则</div>
              <div class="hooks-summary" style="margin-top:10px">
                <div class="hooks-summary-desc">修改大脑目录或运行目录后，服务会重新加载，并把后续数据写入新的根路径。</div>
                <div class="hooks-summary-desc">长期内容应通过 writeback/promotion 进入大脑，而不是让运行日志和会话直接滞留在知识库。</div>
              </div>
            </div>
            <div class="task-map-node-section">
              <div class="task-map-node-section-title">浏览器通知</div>
              <div class="hooks-summary" style="margin-top:10px">
                <div class="hooks-summary-desc">${escHtml(notificationState.detail)}</div>
              </div>
            </div>
            ${statusRow}
            <div class="general-settings-actions">
              <button class="new-session-btn" type="submit" ${pending ? 'disabled' : ''}>${pending ? '保存中…' : '保存'}</button>
              <button class="new-session-btn secondary" type="button" data-action="enable-browser-notifications" ${(pending || requestingBrowserNotifications || !notificationState.supported) ? 'disabled' : ''}>${requestingBrowserNotifications ? '请求中…' : escHtml(notificationState.buttonLabel)}</button>
              <button class="new-session-btn secondary" type="button" data-action="reload-general-settings" ${pending ? 'disabled' : ''}>重新加载</button>
            </div>
          </form>
        </div>
      </div>
    `;

    body.querySelector?.('[data-general-settings-form]')?.addEventListener?.('submit', (event) => {
      event.preventDefault?.();
      void saveSettings(event.currentTarget);
    });
    body.querySelector?.('[data-action="reload-general-settings"]')?.addEventListener?.('click', () => {
      if (pending) return;
      success = '';
      error = '';
      void fetchSettings();
    });
    body.querySelector?.('[data-action="enable-browser-notifications"]')?.addEventListener?.('click', () => {
      void requestBrowserNotifications();
    });
  }

  function showGeneralSettings() {
    void fetchSettings();
  }

  settingsPanel.registerTab({
    id: 'general',
    onShow: showGeneralSettings,
  });
})(window);
