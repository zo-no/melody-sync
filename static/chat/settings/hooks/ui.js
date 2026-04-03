// ── Hooks Settings UI ─────────────────────────────────────────────────────────

(function () {
  const hooksModel = window.MelodySyncHooksSettingsModel;
  const overlay = document.getElementById('hooksOverlay');
  const openBtn = document.getElementById('hooksSettingsBtn');
  const closeBtn = document.getElementById('hooksOverlayClose');
  const body = document.getElementById('hooksPanelBody');

  if (!overlay || !openBtn || !body || !hooksModel) return;

  // ── State ────────────────────────────────────────────────────────────────────
  let hooksData = null; // { events: string[], hooks: HookMeta[] }

  // ── Fetch ────────────────────────────────────────────────────────────────────
  async function loadHooks() {
    body.innerHTML = '<div class="hooks-loading">加载中…</div>';
    try {
      const res = await fetch('/api/hooks', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      hooksData = await res.json();
      render();
    } catch (err) {
      body.innerHTML = `<div class="hooks-error">加载失败：${err.message}</div>`;
    }
  }

  async function patchHook(hookId, enabled) {
    try {
      const res = await fetch(`/api/hooks/${encodeURIComponent(hookId)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      hooksData = { ...hooksData, hooks: data.hooks };
      render();
    } catch (err) {
      console.error('[hooks-ui] patch failed:', err.message);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  function render() {
    if (!hooksData) return;
    const { hooks } = hooksData;
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

    const intro = `
      <div class="hooks-summary">
        <div class="hooks-summary-desc">按完整闭环流程查看，只显示当前生命周期节点下已经接入的 Hook。</div>
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
      ? `${intro}<div class="hooks-phase-list">${phaseSections}</div>${flowchart}`
      : '<div class="hooks-empty">暂无已声明的生命周期</div>';

    // Bind toggle events
    body.querySelectorAll('input[data-hook-id]').forEach((input) => {
      input.addEventListener('change', () => {
        patchHook(input.dataset.hookId, input.checked);
      });
    });
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Open / close ─────────────────────────────────────────────────────────────
  function openOverlay() {
    overlay.hidden = false;
    document.body.classList.add('hooks-overlay-open');
    loadHooks();
  }

  function closeOverlay() {
    overlay.hidden = true;
    document.body.classList.remove('hooks-overlay-open');
  }

  openBtn.addEventListener('click', openOverlay);
  closeBtn?.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeOverlay();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) closeOverlay();
  });
})();
