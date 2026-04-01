// ── Hooks Settings UI ─────────────────────────────────────────────────────────

(function () {
  const overlay = document.getElementById('hooksOverlay');
  const openBtn = document.getElementById('hooksSettingsBtn');
  const closeBtn = document.getElementById('hooksOverlayClose');
  const body = document.getElementById('hooksPanelBody');

  if (!overlay || !openBtn || !body) return;

  // ── Event label map ──────────────────────────────────────────────────────────
  const EVENT_LABELS = {
    'session.created': 'Session 创建后',
    'run.started':     'Run 启动后',
    'run.completed':   'Run 完成后',
    'run.failed':      'Run 失败/取消后',
  };

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
    const { events, hooks } = hooksData;

    // Group hooks by eventPattern
    const byEvent = {};
    for (const event of events) byEvent[event] = [];
    for (const hook of hooks) {
      const key = hook.eventPattern;
      if (!byEvent[key]) byEvent[key] = [];
      byEvent[key].push(hook);
    }

    const sections = [];
    for (const event of events) {
      const list = byEvent[event] || [];
      if (list.length === 0) continue;

      const label = EVENT_LABELS[event] || event;
      const items = list.map((hook) => {
        const toggleId = `hook-toggle-${hook.id.replace(/[^a-z0-9]/gi, '-')}`;
        return `
          <div class="hooks-item${hook.enabled ? '' : ' hooks-item-disabled'}">
            <div class="hooks-item-info">
              <span class="hooks-item-label">${escHtml(hook.label)}</span>
              ${hook.description ? `<span class="hooks-item-desc">${escHtml(hook.description)}</span>` : ''}
              ${hook.builtIn ? '<span class="hooks-item-badge">内置</span>' : ''}
            </div>
            <label class="hooks-toggle" title="${hook.enabled ? '点击禁用' : '点击启用'}">
              <input type="checkbox" id="${toggleId}"
                data-hook-id="${escHtml(hook.id)}"
                ${hook.enabled ? 'checked' : ''}
                ${hook.builtIn ? '' : ''}>
              <span class="hooks-toggle-track"></span>
            </label>
          </div>`;
      }).join('');

      sections.push(`
        <div class="hooks-section">
          <div class="hooks-section-title">${escHtml(label)}</div>
          ${items}
        </div>`);
    }

    body.innerHTML = sections.length
      ? sections.join('')
      : '<div class="hooks-empty">暂无已注册的 Hooks</div>';

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
