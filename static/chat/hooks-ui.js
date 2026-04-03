// ── Hooks Settings UI ─────────────────────────────────────────────────────────

(function () {
  const overlay = document.getElementById('hooksOverlay');
  const openBtn = document.getElementById('hooksSettingsBtn');
  const closeBtn = document.getElementById('hooksOverlayClose');
  const body = document.getElementById('hooksPanelBody');

  if (!overlay || !openBtn || !body) return;

  // ── State ────────────────────────────────────────────────────────────────────
  let hooksData = null; // { events: string[], hooks: HookMeta[] }
  const FALLBACK_LAYER_ORDER = ["boot", "lifecycle", "delivery", "other"];
  const FALLBACK_LAYER_DEFINITIONS = {
    boot: {
      label: "Boot Hooks",
      description: "实例首次启动、启动恢复、运行环境初始化相关的 hooks。",
    },
    lifecycle: {
      label: "Lifecycle Hooks",
      description: "会话、Run、支线和完成闭环相关的生命周期派生处理。",
    },
    delivery: {
      label: "Delivery Hooks",
      description: "对外通知、邮件、回调等外部交付副作用。",
    },
    other: {
      label: "Other Hooks",
      description: "未归入标准生命周期层的 hooks。",
    },
  };
  const FALLBACK_UI_TARGET_DEFINITIONS = [
    { id: 'session_stream', label: 'Session Stream' },
    { id: 'task_status_strip', label: 'Task Status Strip' },
    { id: 'task_action_panel', label: 'Task Action Panel' },
    { id: 'task_map', label: 'Task Map Surface' },
    { id: 'task_list_rows', label: 'Task List Rows' },
    { id: 'task_list_badges', label: 'Task List Badges' },
    { id: 'composer_assist', label: 'Composer Assist' },
    { id: 'workspace_notices', label: 'Workspace Notices' },
    { id: 'settings_panels', label: 'Settings Panels' },
  ];

  function normalizeLayerDefinitions(data) {
    const entries = Array.isArray(data?.layerDefinitions) ? data.layerDefinitions : [];
    if (entries.length === 0) {
      return new Map(Object.entries(FALLBACK_LAYER_DEFINITIONS));
    }
    const next = new Map();
    for (const definition of entries) {
      const id = String(definition?.id || "").trim().toLowerCase();
      if (!id) continue;
      next.set(id, {
        label: String(definition?.label || FALLBACK_LAYER_DEFINITIONS[id]?.label || id),
        description: String(definition?.description || FALLBACK_LAYER_DEFINITIONS[id]?.description || ""),
      });
    }
    if (!next.has("other")) {
      next.set("other", FALLBACK_LAYER_DEFINITIONS.other);
    }
    return next;
  }

  function getLayerOrder(data, layerMap) {
    const configured = Array.isArray(data?.layerOrder) ? data.layerOrder : [];
    const normalized = configured
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter((entry) => entry && layerMap.has(entry));
    const fallback = FALLBACK_LAYER_ORDER.filter((entry) => layerMap.has(entry));
    const combined = [...normalized];
    for (const entry of fallback) {
      if (!combined.includes(entry)) combined.push(entry);
    }
    for (const entry of layerMap.keys()) {
      if (!combined.includes(entry)) combined.push(entry);
    }
    return combined;
  }

  function normalizeEventDefinitions(data) {
    const definitions = Array.isArray(data?.eventDefinitions) ? data.eventDefinitions : [];
    if (definitions.length > 0) return definitions;
    return (Array.isArray(data?.events) ? data.events : []).map((eventId) => ({
      id: eventId,
      label: eventId,
      description: '',
    }));
  }

  function getEventDefinitionMap(data) {
    return new Map(
      normalizeEventDefinitions(data)
        .filter((definition) => definition?.id)
        .map((definition) => [definition.id, definition]),
    );
  }

  function getLayerLabel(layer, layerMap) {
    return layerMap.get(layer)?.label || layerMap.get("other")?.label || FALLBACK_LAYER_DEFINITIONS.other.label;
  }

  function getLayerDescription(layer, layerMap) {
    return layerMap.get(layer)?.description || layerMap.get("other")?.description || FALLBACK_LAYER_DEFINITIONS.other.description;
  }

  function getHookLayer(hook, layerMap) {
    const normalized = String(hook?.layer || "").trim().toLowerCase();
    return normalized && layerMap.has(normalized) ? normalized : "other";
  }

  function normalizeUiTargetDefinitions(data) {
    const definitions = Array.isArray(data?.uiTargetDefinitions) ? data.uiTargetDefinitions : [];
    return definitions.length > 0 ? definitions : FALLBACK_UI_TARGET_DEFINITIONS;
  }

  function createEventHookIndex(hooks) {
    const next = new Map();
    for (const hook of hooks) {
      const eventId = String(hook?.eventPattern || '').trim();
      if (!eventId) continue;
      if (!next.has(eventId)) next.set(eventId, []);
      next.get(eventId).push(hook);
    }
    return next;
  }

  function getHookCoverage(eventDefinitions, eventIndex) {
    const covered = [];
    const uncovered = [];
    for (const definition of eventDefinitions) {
      const hooks = eventIndex.get(definition.id) || [];
      if (hooks.length > 0) {
        covered.push(definition);
      } else {
        uncovered.push(definition);
      }
    }
    return { covered, uncovered };
  }

  function getLayerStats(layer, hooks, layerMap, eventIndex) {
    const layerHooks = hooks.filter((hook) => getHookLayer(hook, layerMap) === layer);
    const eventIds = Array.from(new Set(layerHooks.map((hook) => String(hook?.eventPattern || '').trim()).filter(Boolean)));
    const enabledCount = layerHooks.filter((hook) => hook.enabled).length;
    return {
      hookCount: layerHooks.length,
      eventCount: eventIds.length,
      enabledCount,
      disabledCount: layerHooks.length - enabledCount,
      layerHooks,
      eventIds,
      eventIndex,
    };
  }

  function renderChipList(items, className) {
    if (!Array.isArray(items) || items.length === 0) return '';
    return `
      <div class="${className}">
        ${items.join('')}
      </div>`;
  }

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
    const { hooks, settings } = hooksData;
    const eventDefinitions = normalizeEventDefinitions(hooksData);
    const eventDefinitionMap = getEventDefinitionMap(hooksData);
    const layerMap = normalizeLayerDefinitions(hooksData);
    const layerOrder = getLayerOrder(hooksData, layerMap);
    const eventIndex = createEventHookIndex(hooks);
    const coverage = getHookCoverage(eventDefinitions, eventIndex);
    const enabledHooks = hooks.filter((hook) => hook.enabled);
    const uiTargets = normalizeUiTargetDefinitions(hooksData);
    const reservedTruths = Array.isArray(hooksData?.uiReservedTruths) ? hooksData.uiReservedTruths : [];

    const sections = [];
    for (const layer of layerOrder) {
      const { hookCount, eventCount, enabledCount, disabledCount, eventIds } = getLayerStats(layer, hooks, layerMap, eventIndex);
      if (hookCount === 0) continue;
      const eventSections = [];
      const orderedEventIds = eventDefinitions
        .map((definition) => definition.id)
        .filter((eventId) => eventIds.includes(eventId));
      for (const eventId of orderedEventIds) {
        const list = (eventIndex.get(eventId) || []).filter((hook) => getHookLayer(hook, layerMap) === layer);
        if (list.length === 0) continue;
        const definition = eventDefinitionMap.get(eventId) || null;
        const label = definition?.label || eventId;
        const items = list.map((hook) => {
          const toggleId = `hook-toggle-${hook.id.replace(/[^a-z0-9]/gi, '-')}`;
          const badges = [
            hook.builtIn ? '<span class="hooks-item-badge">内置</span>' : "",
            hook.enabled
              ? '<span class="hooks-item-badge hooks-item-badge-success">启用中</span>'
              : '<span class="hooks-item-badge hooks-item-badge-muted">已停用</span>',
          ].filter(Boolean).join("");
          return `
            <div class="hooks-item${hook.enabled ? '' : ' hooks-item-disabled'}">
              <div class="hooks-item-info">
                <span class="hooks-item-label">${escHtml(hook.label)}</span>
                ${hook.description ? `<span class="hooks-item-desc">${escHtml(hook.description)}</span>` : ''}
                <div class="hooks-item-meta">
                  ${badges}
                  ${hook.sourceModule ? `<span class="hooks-item-source">${escHtml(hook.sourceModule)}</span>` : ''}
                </div>
              </div>
              <label class="hooks-toggle" title="${hook.enabled ? '点击禁用' : '点击启用'}">
                <input type="checkbox" id="${toggleId}"
                  data-hook-id="${escHtml(hook.id)}"
                  ${hook.enabled ? 'checked' : ''}>
                <span class="hooks-toggle-track"></span>
              </label>
            </div>`;
        }).join("");

        eventSections.push(`
          <div class="hooks-event-card">
            <div class="hooks-event-card-header">
              <div class="hooks-event-card-title">${escHtml(label)}</div>
              <span class="hooks-event-card-count">${list.length} hooks</span>
            </div>
            ${definition?.description ? `<div class="hooks-section-desc">${escHtml(definition.description)}</div>` : ''}
            ${items}
          </div>`);
      }

      sections.push(`
        <section class="hooks-layer">
          <div class="hooks-layer-header">
            <div>
              <div class="hooks-layer-title">${escHtml(getLayerLabel(layer, layerMap))}</div>
              <div class="hooks-layer-desc">${escHtml(getLayerDescription(layer, layerMap))}</div>
            </div>
            <div class="hooks-layer-stats">
              <span class="hooks-layer-stat">${hookCount} hooks</span>
              <span class="hooks-layer-stat">${eventCount} events</span>
              <span class="hooks-layer-stat">${enabledCount} on</span>
              ${disabledCount > 0 ? `<span class="hooks-layer-stat hooks-layer-stat-muted">${disabledCount} off</span>` : ''}
            </div>
          </div>
          ${eventSections.join("")}
        </section>`);
    }

    const storagePath = String(settings?.storagePath || "").trim();
    const uiTargetChips = uiTargets.map((target) => {
      const label = escHtml(target?.label || target?.id || '');
      const desc = escHtml(target?.description || '');
      return `<span class="hooks-chip" title="${desc}">${label}</span>`;
    });
    const reservedTruthChips = (reservedTruths.length > 0 ? reservedTruths : [
      { id: 'task_list_order', description: '' },
      { id: 'task_map_nodes', description: '' },
    ]).map((entry) => {
      const id = escHtml(entry?.id || '');
      const desc = escHtml(entry?.description || '');
      return `<span class="hooks-chip hooks-chip-danger" title="${desc}">${id}</span>`;
    });
    const uncoveredEventChips = coverage.uncovered.map((definition) => (
      `<span class="hooks-chip hooks-chip-muted" title="${escHtml(definition?.description || '')}">${escHtml(definition?.label || definition?.id || '')}</span>`
    ));
    const summary = `
      <div class="hooks-summary">
        <div class="hooks-summary-title">Hooks 是生命周期自动化，不是项目真值</div>
        <div class="hooks-summary-desc">它们负责在启动、会话推进、支线隔离和完成闭环的时机运行，写会话事件、UI 提示和外部副作用。</div>
        <div class="hooks-summary-grid">
          <div class="hooks-summary-card">
            <div class="hooks-summary-card-label">已启用</div>
            <div class="hooks-summary-card-value">${enabledHooks.length} / ${hooks.length}</div>
            <div class="hooks-summary-card-note">开关会持久化</div>
          </div>
          <div class="hooks-summary-card">
            <div class="hooks-summary-card-label">生命周期覆盖</div>
            <div class="hooks-summary-card-value">${coverage.covered.length} / ${eventDefinitions.length}</div>
            <div class="hooks-summary-card-note">已有内建 hook 的事件数</div>
          </div>
          <div class="hooks-summary-card">
            <div class="hooks-summary-card-label">可作用 UI 表面</div>
            <div class="hooks-summary-card-value">${uiTargets.length}</div>
            <div class="hooks-summary-card-note">几乎全部 UI 表面</div>
          </div>
          <div class="hooks-summary-card">
            <div class="hooks-summary-card-label">保留真值</div>
            <div class="hooks-summary-card-value">${reservedTruthChips.length}</div>
            <div class="hooks-summary-card-note">hooks 不能直接拥有</div>
          </div>
        </div>
        <div class="hooks-summary-block">
          <div class="hooks-summary-subtitle">可操作 UI 表面</div>
          <div class="hooks-summary-desc">Hook 可以更新会话流、任务状态、任务地图、任务列表和输入辅助，但不直接接管 durable truth。</div>
          ${renderChipList(uiTargetChips, 'hooks-chip-list')}
        </div>
        <div class="hooks-summary-block">
          <div class="hooks-summary-subtitle">保留真值</div>
          <div class="hooks-summary-desc">下面这些真值仍由主流程和 contract 维护，不应由 hooks 直接接管。</div>
          ${renderChipList(reservedTruthChips, 'hooks-chip-list')}
        </div>
        <div class="hooks-summary-block">
          <div class="hooks-summary-subtitle">待接入生命周期</div>
          <div class="hooks-summary-desc">这些事件已经在 contract 里声明，但当前还没有内建 hook 绑定。</div>
          ${uncoveredEventChips.length > 0 ? renderChipList(uncoveredEventChips, 'hooks-chip-list') : '<div class="hooks-summary-desc">当前所有已声明事件都已有内建 hook。</div>'}
        </div>
        ${storagePath ? `<div class="hooks-summary-path">${escHtml(storagePath)}</div>` : ''}
      </div>`;

    body.innerHTML = sections.length
      ? `${summary}${sections.join('')}`
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
