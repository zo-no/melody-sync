(function voiceSettingsUiModule(global) {
  const body = global.document?.getElementById?.('voiceSettingsPanelBody');
  const settingsPanel = global.MelodySyncSettingsPanel;
  const settingsModel = global.MelodySyncVoiceSettingsModel;

  if (!body || !settingsPanel || !settingsModel) return;

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

  function checkedAttr(value) {
    return value ? 'checked' : '';
  }

  function getNamedField(form, name) {
    return form?.elements?.namedItem?.(name) || null;
  }

  function getFieldValue(form, name) {
    const field = getNamedField(form, name);
    return typeof field?.value === 'string' ? field.value : '';
  }

  function getCheckboxValue(form, name) {
    return getNamedField(form, name)?.checked === true;
  }

  function formatNumberValue(value, fallback = '') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    return fallback;
  }

  function renderSelectOptions(options, selectedValue) {
    return (Array.isArray(options) ? options : [])
      .map((option) => {
        const value = String(option?.value || '').trim();
        const label = String(option?.label || value).trim();
        return `<option value="${escHtml(value)}" ${value === selectedValue ? 'selected' : ''}>${escHtml(label)}</option>`;
      })
      .join('');
  }

  async function fetchSettings() {
    body.innerHTML = '<div class="hooks-loading">加载中…</div>';
    try {
      loaded = await settingsModel.fetchSettings();
      pending = false;
      error = '';
      render();
    } catch (err) {
      body.innerHTML = `<div class="hooks-error">加载失败：${escHtml(err.message)}</div>`;
    }
  }

  async function saveSettings(form) {
    if (pending || !form) return;
    pending = true;
    error = '';
    success = '';
    render();
    try {
      const next = await settingsModel.saveSettings({
        mode: getFieldValue(form, 'mode').trim(),
        wakePhrase: getFieldValue(form, 'wakePhrase').trim(),
        ttsEnabled: getCheckboxValue(form, 'ttsEnabled'),
        ttsVolume: getFieldValue(form, 'ttsVolume').trim(),
        playbackVolume: getFieldValue(form, 'playbackVolume').trim(),
      });
      loaded = next || loaded;
      pending = false;
      success = '已保存';
      render();
    } catch (err) {
      pending = false;
      error = err?.message || '保存失败';
      render();
    }
  }

  function renderStatusRows() {
    if (!loaded) return '';
    const rows = [];
    if (loaded.paths?.voiceRoot) {
      rows.push(`<div class="hooks-summary-desc"><strong>语音目录：</strong><code>${escHtml(loaded.paths.voiceRoot)}</code></div>`);
    }
    if (loaded.paths?.configFile) {
      rows.push(`<div class="hooks-summary-desc"><strong>配置文件：</strong><code>${escHtml(loaded.paths.configFile)}</code></div>`);
    }
    if (loaded.paths?.runtimeLogFile) {
      rows.push(`<div class="hooks-summary-desc"><strong>运行日志：</strong><code>${escHtml(loaded.paths.runtimeLogFile)}</code></div>`);
    }
    if (loaded.paths?.eventsLogFile) {
      rows.push(`<div class="hooks-summary-desc"><strong>事件日志：</strong><code>${escHtml(loaded.paths.eventsLogFile)}</code></div>`);
    }
    if (loaded.status?.label) {
      rows.push(`<div class="hooks-summary-desc"><strong>当前状态：</strong>${escHtml(loaded.status.label)}</div>`);
    }
    return rows.join('');
  }

  function renderRequirements(hint) {
    const requirements = Array.isArray(hint?.requirements) ? hint.requirements : [];
    if (!requirements.length) return '';
    return requirements
      .map((item) => `<div class="hooks-summary-desc">- ${escHtml(item)}</div>`)
      .join('');
  }

  function render() {
    if (!loaded) return;
    const simple = loaded.simpleConfig || {};
    const options = loaded.options || {};
    const hints = loaded.hints || {};
    const mode = simple.mode || 'disabled';
    const activeHint = mode === 'wake' ? (hints.wake || {}) : (hints.passive || {});
    const statusRow = error
      ? `<div class="hooks-error">保存失败：${escHtml(error)}</div>`
      : (success ? `<div class="hooks-summary"><div class="hooks-summary-desc">${escHtml(success)}</div></div>` : '');

    body.innerHTML = `
      <div class="hooks-phase-section">
        <div class="hooks-phase-header">
          <div class="hooks-phase-heading">
            <div class="hooks-phase-title">Voice 设置</div>
            <div class="hooks-phase-desc">这里只选择监听方式。底层唤醒、录音、转写命令由系统内置维护。</div>
          </div>
        </div>
        <div class="hooks-event-card">
          <form data-voice-settings-form style="display:flex;flex-direction:column;gap:12px;padding:12px 0;">
            <div class="task-map-node-section">
              <div class="task-map-node-section-title">监听方式</div>
              <div class="task-map-node-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));display:grid;gap:12px;">
                <label class="task-map-node-field">
                  <span class="task-map-node-field-label">模式</span>
                  <select class="settings-inline-input" name="mode">${renderSelectOptions(options.simpleModes, mode)}</select>
                </label>
                <label class="task-map-node-field" style="flex-direction:row;align-items:center;gap:8px;margin-top:24px;">
                  <input type="checkbox" name="ttsEnabled" ${checkedAttr(simple.ttsEnabled !== false)}>
                  <span class="task-map-node-field-label">播报回复</span>
                </label>
              </div>
              ${mode === 'wake' ? `
                <label class="task-map-node-field" style="margin-top:12px;">
                  <span class="task-map-node-field-label">唤醒词</span>
                  <input class="settings-inline-input" name="wakePhrase" value="${escHtml(simple.wakePhrase)}" placeholder="小罗小罗">
                </label>
              ` : '<input type="hidden" name="wakePhrase" value="">'}
              <div class="hooks-summary-desc" style="margin-top:12px;">
                <strong>${escHtml(activeHint.title || '')}</strong>${activeHint.description ? `：${escHtml(activeHint.description)}` : ''}
              </div>
              ${renderRequirements(activeHint)}
            </div>

            <div class="task-map-node-section">
              <div class="task-map-node-section-title">播报音量</div>
              <div class="task-map-node-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));display:grid;gap:12px;">
                <label class="task-map-node-field">
                  <span class="task-map-node-field-label">语音合成音量</span>
                  <input
                    class="settings-inline-input"
                    type="number"
                    name="ttsVolume"
                    min="0"
                    max="100"
                    step="1"
                    value="${escHtml(formatNumberValue(simple.ttsVolume, '50'))}"
                  >
                  <span class="hooks-summary-desc">0 到 100，控制讯飞合成音量。</span>
                </label>
                <label class="task-map-node-field">
                  <span class="task-map-node-field-label">本地播放音量</span>
                  <input
                    class="settings-inline-input"
                    type="number"
                    name="playbackVolume"
                    min="0"
                    max="2"
                    step="0.1"
                    value="${escHtml(formatNumberValue(simple.playbackVolume, '0.8'))}"
                  >
                  <span class="hooks-summary-desc">0.0 到 2.0，控制这台机器最终播出的响度。</span>
                </label>
              </div>
            </div>

            <div class="task-map-node-section">
              <div class="task-map-node-section-title">本地状态</div>
              <div class="hooks-summary">${renderStatusRows()}</div>
            </div>
            ${statusRow}
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button class="new-session-btn" type="submit" ${pending ? 'disabled' : ''}>${pending ? '保存中…' : '保存'}</button>
              <button class="new-session-btn secondary" type="button" data-action="reload-voice-settings" ${pending ? 'disabled' : ''}>重新加载</button>
            </div>
          </form>
        </div>
      </div>
    `;

    body.querySelector?.('[data-voice-settings-form]')?.addEventListener?.('submit', (event) => {
      event.preventDefault?.();
      void saveSettings(event.currentTarget);
    });
    body.querySelector?.('[data-action="reload-voice-settings"]')?.addEventListener?.('click', () => {
      if (pending) return;
      success = '';
      error = '';
      void fetchSettings();
    });
  }

  function showVoiceSettings() {
    void fetchSettings();
  }

  settingsPanel.registerTab({
    id: 'voice',
    onShow: showVoiceSettings,
  });
})(window);
