(function generalSettingsUiModule(global) {
  const body = global.document?.getElementById?.('generalSettingsPanelBody');
  const settingsPanel = global.MelodySyncSettingsPanel;

  if (!body || !settingsPanel) return;

  let loaded = null;

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
      render();
    } catch (err) {
      body.innerHTML = `<div class="hooks-error">加载失败：${escHtml(err.message)}</div>`;
    }
  }

  function render() {
    if (!loaded) return;
    const value = loaded.storageRootPath || loaded.obsidianPath || '';
    const appRoot = loaded.appRoot || '';
    const customHooksPath = loaded.customHooksPath || '';
    const storagePath = loaded.storagePath || '';
    const agentsPath = loaded.agentsPath || '';
    const agentsContent = loaded.agentsContent || '';
    const agentsContentEscaped = escHtml(agentsContent);
    const metaRows = [
      value ? `<div class="hooks-summary-desc"><strong>本地数据根路径：</strong><code>${escHtml(value)}</code></div>` : '',
      appRoot ? `<div class="hooks-summary-desc"><strong>应用目录：</strong><code>${escHtml(appRoot)}</code></div>` : '',
      storagePath ? `<div class="hooks-summary-desc"><strong>后端设置文件：</strong><code>${escHtml(storagePath)}</code></div>` : '',
      agentsPath ? `<div class="hooks-summary-desc"><strong>Agent 说明文件：</strong><code>${escHtml(agentsPath)}</code></div>` : '',
      customHooksPath ? `<div class="hooks-summary-desc"><strong>自定义 Hook 设计文件：</strong><code>${escHtml(customHooksPath)}</code></div>` : '',
    ].filter(Boolean).join('');
    const patchExample = `PATCH /api/settings\n{\n  "obsidianPath": "${escHtml(value || '/Users/xxx/diary/diary')}",\n  "agentsPath": "${escHtml(agentsPath || '/Users/xxx/diary/diary/00-🤖agent/AGENTS.md')}"\n}`;
    body.innerHTML = `
      <div class="hooks-phase-section">
        <div class="hooks-phase-header">
          <div class="hooks-phase-heading">
            <div class="hooks-phase-title">通用设置</div>
            <div class="hooks-phase-desc">前端只展示当前后端配置，不直接修改。程序数据会默认收敛到配置好的本地数据根路径下的 <code>.melodysync</code> 应用目录里。</div>
          </div>
        </div>
        <div class="hooks-event-card">
          <div style="display:flex;flex-direction:column;gap:10px;padding:12px 0;">
            <div class="hooks-summary">
              <div class="hooks-summary-desc"><strong>配置方式：</strong>修改请调用 <code>PATCH /api/settings</code>，或直接更新后端设置文件。</div>
            </div>
            <div class="task-map-node-section">
              <div class="task-map-node-section-title">当前配置</div>
              <div class="hooks-summary">${metaRows}</div>
            </div>
            <div class="task-map-node-section">
              <div class="task-map-node-section-title">修改入口</div>
              <div class="hooks-summary">
                <div class="hooks-summary-desc"><strong>接口：</strong><code>PATCH /api/settings</code></div>
                <div class="hooks-summary-desc"><strong>说明：</strong>后端配置文件是真值，网页仅做展示。你可以通过 API 请求修改路径与 AGENTS 文件位置。</div>
              </div>
              <pre class="hooks-empty-note" style="white-space:pre-wrap;">${patchExample}</pre>
            </div>
            <div class="task-map-node-section">
              <div class="task-map-node-section-title">AGENTS.md</div>
              <div class="hooks-summary">
                <div class="hooks-summary-desc"><strong>当前内容：</strong>这里只读展示当前后端已加载的 AGENTS.md。</div>
              </div>
              <pre class="hooks-empty-note" style="white-space:pre-wrap;max-height:320px;overflow:auto;">${agentsContentEscaped}</pre>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function showGeneralSettings() {
    void fetchSettings();
  }

  settingsPanel.registerTab({
    id: 'general',
    onShow: showGeneralSettings,
  });
})(window);
