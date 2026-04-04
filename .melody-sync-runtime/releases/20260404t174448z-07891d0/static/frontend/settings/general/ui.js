(function generalSettingsUiModule(global) {
  const body = global.document?.getElementById?.('generalSettingsPanelBody');
  const settingsPanel = global.MelodySyncSettingsPanel;

  if (!body || !settingsPanel) return;

  let loaded = null;
  let pending = false;
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
      const response = await global.fetch('/api/settings', {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      loaded = await response.json();
      pending = false;
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

  function scheduleReloadAfterConfigSwitch() {
    let attempts = 0;
    const maxAttempts = 12;
    const delayMs = 600;

    async function poll() {
      attempts += 1;
      try {
        const response = await global.fetch('/api/settings', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (response.ok) {
          global.location?.reload?.();
          return;
        }
      } catch {
        // Keep polling until the restarted service becomes reachable.
      }
      if (attempts < maxAttempts) {
        global.setTimeout?.(poll, delayMs);
      }
    }

    global.setTimeout?.(poll, delayMs);
  }

  async function saveSettings(form) {
    if (pending || !form) return;
    pending = true;
    error = '';
    success = '';
    render();
    try {
      const response = await global.fetch('/api/settings', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appRoot: getNamedField(form, 'appRoot').trim(),
        }),
      });
      const next = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(next?.error || `HTTP ${response.status}`);
      }
      loaded = next || loaded;
      success = next?.reloadRequired
        ? (next?.reloadScheduled ? '已保存，服务正在重新加载新应用目录。' : '已保存，请重启服务以加载新应用目录。')
        : '已保存';
      pending = false;
      render();
      if (next?.reloadRequired && next?.reloadScheduled) {
        scheduleReloadAfterConfigSwitch();
      }
    } catch (err) {
      pending = false;
      error = err?.message || '保存失败';
      render();
    }
  }

  function render() {
    if (!loaded) return;
    const appRoot = loaded.appRoot || '';
    const storagePath = loaded.storagePath || '';
    const bootstrapStoragePath = loaded.bootstrapStoragePath || '';
    const agentsPath = loaded.agentsPath || '';
    const statusRow = error
      ? `<div class="hooks-error">保存失败：${escHtml(error)}</div>`
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
            ${statusRow}
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button class="new-session-btn" type="submit" ${pending ? 'disabled' : ''}>${pending ? '保存中…' : '保存'}</button>
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
  }

  function showGeneralSettings() {
    void fetchSettings();
  }

  settingsPanel.registerTab({
    id: 'general',
    onShow: showGeneralSettings,
  });
})(window);
