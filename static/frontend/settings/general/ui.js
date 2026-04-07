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
        appRoot: getNamedField(form, 'appRoot').trim(),
      });
      loaded = next || loaded;
      success = next?.reloadRequired
        ? (next?.reloadScheduled ? '已保存，服务正在重新加载新应用目录。' : '已保存，请重启服务以加载新应用目录。')
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

  function render() {
    if (!loaded) return;
    const appRoot = loaded.appRoot || '';
    const storagePath = loaded.storagePath || '';
    const bootstrapStoragePath = loaded.bootstrapStoragePath || '';
    const agentsPath = loaded.agentsPath || '';
    const notificationState = describeBrowserNotificationState();
    const statusRow = error
      ? `<div class="hooks-error">操作失败：${escHtml(error)}</div>`
      : (success ? `<div class="hooks-summary"><div class="hooks-summary-desc">${escHtml(success)}</div></div>` : '');
    body.innerHTML = `
      <div class="hooks-phase-section">
        <div class="hooks-phase-header">
          <div class="hooks-phase-heading">
            <div class="hooks-phase-title">通用设置</div>
            <div class="hooks-phase-desc">应用路径决定当前服务从哪里读取和写入本地数据。</div>
          </div>
        </div>
        <div class="hooks-event-card">
          <form data-general-settings-form style="display:flex;flex-direction:column;gap:12px;padding:12px 0;">
            <div class="task-map-node-section">
              <div class="task-map-node-section-title">路径</div>
              <label class="task-map-node-field" style="display:flex;flex-direction:column;gap:6px">
                <span class="hooks-panel-title" style="font-size:13px">应用路径</span>
                <input class="settings-inline-input" name="appRoot" value="${escHtml(appRoot)}" placeholder="/Users/xxx/diary/diary/00-🤖agent">
              </label>
              <div class="hooks-summary" style="margin-top:10px">
                ${appRoot ? `<div class="hooks-summary-desc"><strong>应用目录：</strong><code>${escHtml(appRoot)}</code></div>` : ''}
                ${storagePath ? `<div class="hooks-summary-desc"><strong>后端配置文件：</strong><code>${escHtml(storagePath)}</code></div>` : ''}
                ${bootstrapStoragePath ? `<div class="hooks-summary-desc"><strong>当前设备配置文件：</strong><code>${escHtml(bootstrapStoragePath)}</code></div>` : ''}
                ${agentsPath ? `<div class="hooks-summary-desc"><strong>说明文件：</strong><code>${escHtml(agentsPath)}</code></div>` : ''}
              </div>
            </div>
            <div class="task-map-node-section">
              <div class="task-map-node-section-title">浏览器通知</div>
              <div class="hooks-summary" style="margin-top:10px">
                <div class="hooks-summary-desc">${escHtml(notificationState.detail)}</div>
              </div>
            </div>
            ${statusRow}
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
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
