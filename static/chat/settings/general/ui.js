(function generalSettingsUiModule(global) {
  const body = global.document?.getElementById?.('generalSettingsPanelBody');
  const settingsPanel = global.MelodySyncSettingsPanel;

  if (!body || !settingsPanel) return;

  let loaded = null;
  let pending = false;
  let error = '';
  let savedMessage = '';

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
      savedMessage = '';
      render();
    } catch (err) {
      body.innerHTML = `<div class="hooks-error">加载失败：${escHtml(err.message)}</div>`;
    }
  }

  async function saveSettings(formData) {
    if (pending) return;
    pending = true;
    error = '';
    savedMessage = '';
    render();
    try {
      const response = await global.fetch('/api/settings', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }
      loaded = data || loaded;
      savedMessage = '已保存';
      pending = false;
      render();
    } catch (err) {
      error = err.message || '保存失败';
      pending = false;
      render();
    }
  }

  function getPathInputValue(form) {
    const field = form?.elements?.namedItem?.('obsidianPath');
    return typeof field?.value === 'string' ? field.value.trim() : '';
  }

  function render() {
    if (!loaded) return;
    const value = loaded.obsidianPath || '';
    const hasError = error ? `<div class="hooks-error">保存失败：${escHtml(error)}</div>` : '';
    const note = savedMessage ? `<div class="hooks-summary"><div class="hooks-summary-desc">${escHtml(savedMessage)}</div></div>` : '';
    const valueEscaped = escHtml(value);
    body.innerHTML = `
      <div class="hooks-phase-section">
        <div class="hooks-phase-header">
          <div class="hooks-phase-heading">
            <div class="hooks-phase-title">通用设置</div>
            <div class="hooks-phase-desc">当前仅提供 Obsidian 导出目录配置，可作为所有项目的默认目标路径。</div>
          </div>
        </div>
        <div class="hooks-event-card">
          <form class="general-settings-form" data-form="general-settings" style="display:flex;flex-direction:column;gap:10px;padding:12px 0;">
            <label class="task-map-node-field" style="display:flex;flex-direction:column;gap:6px">
              <span class="hooks-panel-title" style="font-size:13px">Obsidian 根路径</span>
              <input class="settings-inline-input" name="obsidianPath" value="${valueEscaped}" placeholder="/Users/xxx/diary/diary">
            </label>
            ${hasError || ''}
            ${note || ''}
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button class="new-session-btn" type="submit" ${pending ? 'disabled' : ''}>${pending ? '保存中…' : '保存'}</button>
              <button class="new-session-btn secondary" type="button" data-action="reset-general-form" ${pending ? 'disabled' : ''}>清空（恢复默认）</button>
            </div>
          </form>
        </div>
      </div>
    `;

    body.querySelector('[data-form="general-settings"]')?.addEventListener('submit', (event) => {
      event.preventDefault?.();
      const form = event.currentTarget;
      saveSettings({ obsidianPath: getPathInputValue(form) });
    });

    body.querySelector('[data-action="reset-general-form"]')?.addEventListener('click', () => {
      if (pending) return;
      saveSettings({ obsidianPath: '' });
    });

    pending = false;
  }

  function showGeneralSettings() {
    void fetchSettings();
  }

  settingsPanel.registerTab({
    id: 'general',
    onShow: showGeneralSettings,
  });
})(window);
