(function tasksSettingsUiModule(global) {
  const body = global.document?.getElementById?.('tasksSettingsPanelBody');
  const settingsPanel = global.MelodySyncSettingsPanel;

  if (!body || !settingsPanel) return;

  let loaded = false;

  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getProjectList() {
    if (typeof global.getLongTermProjectList === 'function') {
      return global.getLongTermProjectList() || [];
    }
    return [];
  }

  function getCurrentSessionsTabProjectId() {
    if (typeof global.getSessionsTabProjectId === 'function') {
      return global.getSessionsTabProjectId() || '';
    }
    return '';
  }

  function getSystemProjectId() {
    if (typeof global.getSystemProjectId === 'function') {
      return global.getSystemProjectId() || '';
    }
    return '';
  }

  function render() {
    const projects = getProjectList();
    const currentProjectId = getCurrentSessionsTabProjectId();
    const systemProjectId = getSystemProjectId();

    const projectOptions = projects
      .map((p) => {
        const id = String(p?.id || p?.sessionId || '').trim();
        const name = String(p?.name || p?.title || '').trim() || '未命名项目';
        const isSystem = String(p?.taskListOrigin || '').toLowerCase() === 'system';
        const isSelected = id === currentProjectId;
        return `<option value="${esc(id)}" ${isSelected ? 'selected' : ''}>${esc(name)}${isSystem ? ' (默认)' : ''}</option>`;
      })
      .join('');

    const currentProject = projects.find((p) => {
      const id = String(p?.id || p?.sessionId || '').trim();
      return id === currentProjectId;
    });
    const currentName = currentProject
      ? (String(currentProject?.name || currentProject?.title || '').trim() || '未命名项目')
      : (currentProjectId ? '未知项目' : '未绑定');

    body.innerHTML = `
      <div class="settings-page">
        <div class="settings-page-header">
          <div class="settings-page-title">全局任务</div>
          <div class="settings-page-desc">「全局任务」标签页显示某个长期项目的内容，包含长期、短期、等待、收集箱等分类。默认绑定系统自动创建的全局任务项目。</div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">绑定项目</div>
          <div class="settings-section-desc">选择「全局任务」标签页显示哪个长期项目的内容。切换后立即生效。</div>
          <div class="settings-field-row">
            <label class="settings-field-label" for="sessionsTabProjectSelect">当前绑定</label>
            <div class="settings-field-control">
              ${projects.length > 0 ? `
                <select class="settings-inline-select" id="sessionsTabProjectSelect" data-action="change-sessions-project">
                  ${systemProjectId && !projects.find((p) => String(p?.id || p?.sessionId || '').trim() === systemProjectId)
                    ? `<option value="${esc(systemProjectId)}" ${currentProjectId === systemProjectId ? 'selected' : ''}>全局任务 (默认)</option>`
                    : ''}
                  ${projectOptions}
                </select>
              ` : `
                <div class="settings-empty-hint">还没有长期项目。在「长期项目」标签页创建一个项目后，可以在这里绑定。</div>
              `}
            </div>
          </div>
          <div class="settings-field-row">
            <label class="settings-field-label">当前绑定项目</label>
            <div class="settings-field-control">
              <span class="settings-value-chip">${esc(currentName)}</span>
              ${currentProjectId === systemProjectId ? '<span class="settings-badge-system">系统默认</span>' : ''}
            </div>
          </div>
          ${currentProjectId !== systemProjectId && systemProjectId ? `
            <div class="settings-action-row">
              <button class="settings-text-btn" type="button" data-action="reset-sessions-project">恢复默认（全局任务项目）</button>
            </div>
          ` : ''}
        </div>

        <div class="settings-section">
          <div class="settings-section-title">新建任务归属</div>
          <div class="settings-section-desc">点击「开始任务」创建的新任务，会自动进入当前绑定项目的收集箱。你可以在任务列表里把它移到合适的分类。</div>
          <div class="settings-info-row">
            <span class="settings-info-icon">→</span>
            <span>新任务 → <strong>${esc(currentName)}</strong> / 收集箱</span>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">分类说明</div>
          <div class="settings-bucket-list">
            <div class="settings-bucket-item">
              <span class="settings-bucket-name">长期任务</span>
              <span class="settings-bucket-desc">持续推进的长线目标，不需要在近期完成</span>
            </div>
            <div class="settings-bucket-item">
              <span class="settings-bucket-name">短期任务</span>
              <span class="settings-bucket-desc">有明确截止或近期需要完成的任务</span>
            </div>
            <div class="settings-bucket-item">
              <span class="settings-bucket-name">等待任务</span>
              <span class="settings-bucket-desc">等待他人回复或外部条件触发的任务</span>
            </div>
            <div class="settings-bucket-item">
              <span class="settings-bucket-name">收集箱</span>
              <span class="settings-bucket-desc">尚未分类的新任务，定期整理到合适分类</span>
            </div>
            <div class="settings-bucket-item">
              <span class="settings-bucket-name">快捷按钮</span>
              <span class="settings-bucket-desc">AI 自动化快捷操作，一键触发</span>
            </div>
          </div>
        </div>
      </div>
    `;

    body.querySelector?.('[data-action="change-sessions-project"]')?.addEventListener?.('change', (event) => {
      const nextProjectId = String(event.target.value || '').trim();
      if (!nextProjectId) return;
      if (typeof global.setSessionsTabProject === 'function') {
        global.setSessionsTabProject(nextProjectId);
      }
      if (typeof global.renderSessionList === 'function') {
        global.renderSessionList();
      }
      render();
    });

    body.querySelector?.('[data-action="reset-sessions-project"]')?.addEventListener?.('click', () => {
      if (typeof global.setSessionsTabProject === 'function') {
        global.setSessionsTabProject('');
      }
      if (typeof global.renderSessionList === 'function') {
        global.renderSessionList();
      }
      render();
    });
  }

  function showTasksSettings() {
    if (!loaded) {
      loaded = true;
    }
    render();
  }

  settingsPanel.registerTab({
    id: 'tasks',
    onShow: showTasksSettings,
  });
})(window);
