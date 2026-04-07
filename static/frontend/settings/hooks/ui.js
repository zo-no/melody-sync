// ── Hooks Settings UI ─────────────────────────────────────────────────────────

(function () {
  const hooksModel = window.MelodySyncHooksSettingsModel;
  const body = document.getElementById('hooksPanelBody');
  const settingsPanel = window.MelodySyncSettingsPanel;

  if (!body || !hooksModel || !settingsPanel) return;

  // ── State ────────────────────────────────────────────────────────────────────
  let hooksData = null; // { events: string[], hooks: HookMeta[] }
  let testingHostVoice = false;
  let statusMessage = '';
  let statusError = '';

  // ── Fetch ────────────────────────────────────────────────────────────────────
  async function loadHooks() {
    body.innerHTML = '<div class="hooks-loading">加载中…</div>';
    try {
      const res = await fetch('/api/settings/hooks', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      hooksData = await res.json();
      render();
    } catch (err) {
      body.innerHTML = `<div class="hooks-error">加载失败：${err.message}</div>`;
    }
  }

  async function patchHook(hookId, enabled) {
    try {
      const res = await fetch(`/api/settings/hooks/${encodeURIComponent(hookId)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      hooksData = { ...hooksData, hooks: data.hooks };
      statusMessage = '';
      statusError = '';
      render();
    } catch (err) {
      console.error('[hooks-ui] patch failed:', err.message);
      statusMessage = '';
      statusError = err.message || 'Hook 更新失败';
      render();
    }
  }

  async function testHostCompletionVoice() {
    if (testingHostVoice) return;
    testingHostVoice = true;
    statusMessage = '';
    statusError = '';
    render();
    try {
      const appState = globalThis.MelodySyncAppState?.getState?.();
      const currentSession = appState?.currentSessionId
        ? (Array.isArray(appState?.sessions) ? appState.sessions.find((entry) => entry?.id === appState.currentSessionId) || null : null)
        : null;
      const speechText = buildHostVoiceSpeech(currentSession);
      const res = await fetch('/api/system/completion-sound', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speechText }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      statusMessage = '已在这台 Mac 上触发本地语音播报测试。';
    } catch (err) {
      statusError = err?.message || '本地语音播报测试失败';
    } finally {
      testingHostVoice = false;
      render();
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  function normalizeSpeechClause(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/[。！？!?；;：:]+$/g, '')
      .trim();
  }

  function firstNonEmptyText(...values) {
    for (const value of values) {
      const text = normalizeSpeechClause(value);
      if (text) return text;
    }
    return '';
  }

  function buildHostVoiceSpeech(session = null) {
    const sessionName = firstNonEmptyText(session?.name);
    const taskCard = session?.taskCard || {};
    const needsFromUser = Array.isArray(taskCard?.needsFromUser) ? taskCard.needsFromUser : [];
    const nextSteps = Array.isArray(taskCard?.nextSteps) ? taskCard.nextSteps : [];
    const actionHint = firstNonEmptyText(
      needsFromUser[0],
      nextSteps[0],
      taskCard?.checkpoint,
    );
    if (sessionName) return `${sessionName}，需要你处理。`;
    if (actionHint) return '需要你处理。';
    return '需要你处理。';
  }

  function render() {
    if (!hooksData) return;
    const { hooks, settings } = hooksData;
    const eventIndex = hooksModel.createEventHookIndex(hooks);
    const phaseSections = hooksModel.buildPhaseSections(hooksData).map((phaseEntry) => {
      const eventSections = phaseEntry.events.map((definition) => {
        const eventId = String(definition?.id || '').trim();
        const list = eventIndex.get(eventId) || [];
        const hasHooks = list.length > 0;
        const items = list.map((hook) => {
          const toggleId = `hook-toggle-${hook.id.replace(/[^a-z0-9]/gi, '-')}`;
          return `
            <div class="hooks-item${hook.enabled ? '' : ' hooks-item-disabled'}">
              <div class="hooks-item-info">
                <span class="hooks-item-label">${escHtml(hook.label)}</span>
                ${hook.description ? `<span class="hooks-item-desc">${escHtml(hook.description)}</span>` : ''}
              </div>
              <label class="hooks-toggle" title="${hook.enabled ? '点击禁用' : '点击启用'}">
                <input type="checkbox" id="${toggleId}"
                  data-hook-id="${escHtml(hook.id)}"
                  ${hook.enabled ? 'checked' : ''}>
                <span class="hooks-toggle-track"></span>
              </label>
            </div>`;
        }).join('');

        return `
          <section class="hooks-event-card${hasHooks ? '' : ' is-empty'}">
            <div class="hooks-event-card-header">
              <div class="hooks-event-card-heading">
                <div class="hooks-event-card-title">${escHtml(`${definition?.label || eventId}-${eventId}`)}</div>
                ${definition?.description ? `<div class="hooks-section-desc">${escHtml(definition.description)}</div>` : ''}
              </div>
              <span class="hooks-event-card-count${list.length === 0 ? ' hooks-event-card-count-muted' : ''}">
                ${list.length === 0 ? '未接入' : `已接入 ${list.length} 项`}
              </span>
            </div>
            <div class="hooks-event-body">
              ${hasHooks ? items : '<div class="hooks-event-empty">当前该生命周期暂无已接入 Hook。</div>'}
            </div>
          </section>`;
      }).join('');

      const coveredCount = phaseEntry.events.filter((definition) => (eventIndex.get(definition.id) || []).length > 0).length;

      return `
        <section class="hooks-phase-section">
          <div class="hooks-phase-header">
            <div class="hooks-phase-heading">
              <div class="hooks-phase-title">${escHtml(phaseEntry.definition.label)}</div>
              ${phaseEntry.definition.description ? `<div class="hooks-phase-desc">${escHtml(phaseEntry.definition.description)}</div>` : ''}
            </div>
            <span class="hooks-phase-count">
              ${coveredCount}/${phaseEntry.events.length}
            </span>
          </div>
          <div class="hooks-event-list">${eventSections}</div>
        </section>`;
    }).join('');

    const flowSteps = hooksModel.buildLifecycleFlow(hooksData).map((step, index) => `
      <div class="hooks-flow-step">
        <div class="hooks-flow-step-order">${String(index + 1).padStart(2, '0')}</div>
        <div class="hooks-flow-step-copy">
          <div class="hooks-flow-step-title">${escHtml(step.label)}</div>
          ${step.description ? `<div class="hooks-flow-step-desc">${escHtml(step.description)}</div>` : ''}
          <div class="hooks-flow-step-events">节点：${escHtml(step.eventLabels.join(' · '))}</div>
        </div>
      </div>
    `).join('<div class="hooks-flow-arrow" aria-hidden="true">→</div>');

    const customHookNote = settings?.customDesignPath
      ? `<div class="hooks-summary-desc">自定义脚本 Hook 设计文件：<code>${escHtml(settings.customDesignPath)}</code></div>`
      : '';
    const storageNote = settings?.storagePath
      ? `<div class="hooks-summary-desc">启停状态文件：<code>${escHtml(settings.storagePath)}</code></div>`
      : '';
    const hostVoiceHook = Array.isArray(hooks)
      ? hooks.find((hook) => hook?.id === 'builtin.host-completion-voice')
      : null;
    const hostVoiceStatus = hostVoiceHook?.enabled === false ? '已禁用' : '已启用';
    const hostVoiceCard = `
      <section class="hooks-event-card">
        <div class="hooks-event-card-header">
          <div class="hooks-event-card-heading">
            <div class="hooks-event-card-title">本地语音播报</div>
            <div class="hooks-section-desc">这项提醒由 <code>builtin.host-completion-voice</code> 控制。一次执行完成后，在 Mac mini 本地直接执行语音播报。</div>
          </div>
          <span class="hooks-event-card-count">${escHtml(hostVoiceStatus)}</span>
        </div>
        <div class="hooks-event-body" style="display:flex;flex-direction:column;gap:10px;">
          <div class="hooks-summary-desc">启用/禁用请直接切换下面 Hooks 列表中的 <code>本轮完成时主机语音播报</code>。</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="new-session-btn secondary" type="button" data-action="test-host-completion-voice" ${testingHostVoice ? 'disabled' : ''}>${testingHostVoice ? '播放中…' : '测试完成语音播报'}</button>
            ${statusError ? `<span class="hooks-error" style="margin:0">${escHtml(statusError)}</span>` : ''}
            ${statusMessage ? `<span class="hooks-summary-desc">${escHtml(statusMessage)}</span>` : ''}
          </div>
        </div>
      </section>`;

    const intro = `
      <div class="hooks-summary">
        <div class="hooks-summary-desc">按完整闭环流程查看，只显示当前生命周期节点下已经接入的 Hook。</div>
        ${customHookNote}
        ${storageNote}
      </div>`;

    const flowchart = `
      <section class="hooks-flow-chart" role="note" aria-label="生命周期流程说明">
        <div class="hooks-flow-chart-header">
          <div class="hooks-flow-chart-title">生命周期流程</div>
          <div class="hooks-flow-chart-desc">这是说明图，不是可操作区域，用来帮助理解 Hook 会出现在哪个闭环阶段。</div>
        </div>
        <div class="hooks-flow-track">${flowSteps}</div>
      </section>`;

    body.innerHTML = phaseSections
      ? `${intro}${hostVoiceCard}<div class="hooks-phase-list">${phaseSections}</div>${flowchart}`
      : '<div class="hooks-empty">暂无已声明的生命周期</div>';

    // Bind toggle events
    body.querySelectorAll('input[data-hook-id]').forEach((input) => {
      input.addEventListener('change', () => {
        patchHook(input.dataset.hookId, input.checked);
      });
    });
    body.querySelector?.('[data-action="test-host-completion-voice"]')?.addEventListener?.('click', () => {
      void testHostCompletionVoice();
    });
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showHooksSettings() {
    loadHooks();
  }

  settingsPanel.registerTab({
    id: 'hooks',
    onShow: showHooksSettings,
  });
})();
