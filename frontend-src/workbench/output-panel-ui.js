(function outputPanelUiModule(global) {
  const documentRef = global.document;
  // Inline mode: panel lives inside .task-manager-main-column, no overlay
  const inlineEl = documentRef?.getElementById?.('outputPanelInline');
  const refreshButtonEl = documentRef?.getElementById?.('outputPanelRefreshBtn');
  const bodyEl = documentRef?.getElementById?.('outputPanelBody');

  if (!inlineEl || !refreshButtonEl || !bodyEl) {
    return;
  }

  let payload = null;
  let errorMessage = '';
  let loading = false;
  let refreshTimer = null;
  let liveRefreshTimer = null;
  let contextPollTimer = null;
  let lastContextKey = '';
  let refreshPromise = null;
  let activeRequestController = null;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatCount(value) {
    return Number.isFinite(value) ? `${value}` : '0';
  }

  function formatPercent(value) {
    const ratio = Number.isFinite(value) ? Math.max(0, value) : 0;
    return `${Math.round(ratio * 100)}%`;
  }

  function formatPoolDelta(value) {
    const delta = Number.isFinite(value) ? Math.round(value) : 0;
    if (delta > 0) return `净增 ${delta}`;
    if (delta < 0) return `净减 ${Math.abs(delta)}`;
    return '持平';
  }

  function formatStamp(value) {
    const stamp = Date.parse(String(value || '').trim());
    if (!Number.isFinite(stamp) || stamp <= 0) return '';
    const date = new Date(stamp);
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hour = `${date.getHours()}`.padStart(2, '0');
    const minute = `${date.getMinutes()}`.padStart(2, '0');
    return `${month}-${day} ${hour}:${minute}`;
  }

  function getCurrentSessionId() {
    try {
      const currentUrl = new global.URL(global.location?.href || '', global.location?.origin || undefined);
      const sessionId = String(currentUrl.searchParams.get('session') || '').trim();
      return sessionId || '';
    } catch {
      return '';
    }
  }

  function normalizeScope(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    return ['long-term', 'longterm', 'persistent', 'recurring'].includes(normalized)
      ? 'long-term'
      : 'sessions';
  }

  function getCurrentScope() {
    try {
      const currentUrl = new global.URL(global.location?.href || '', global.location?.origin || undefined);
      return normalizeScope(
        currentUrl.searchParams.get('scope')
        || currentUrl.searchParams.get('tab')
        || '',
      );
    } catch {
      return 'sessions';
    }
  }

  function getCurrentContextKey() {
    return `${getCurrentScope()}::${getCurrentSessionId()}`;
  }

  function buildOutputPanelUrl(sessionId = '', scope = 'sessions') {
    const normalizedSessionId = String(sessionId || '').trim();
    const normalizedScope = normalizeScope(scope);
    const searchParams = new global.URLSearchParams();
    if (normalizedSessionId) {
      searchParams.set('sessionId', normalizedSessionId);
    }
    if (normalizedScope !== 'sessions') {
      searchParams.set('scope', normalizedScope);
    }
    const query = searchParams.toString();
    return query ? `/api/output-panel?${query}` : '/api/output-panel';
  }

  function getWorkflowInfo(session = {}) {
    const workflowState = String(session?.workflowState || '').trim();
    if (workflowState === 'done') {
      return { label: '已完成', tone: 'done' };
    }
    if (workflowState === 'waiting_user') {
      return { label: '等待你处理', tone: 'waiting-user' };
    }
    if (workflowState === 'parked') {
      return { label: '已停放', tone: 'parked' };
    }
    return {
      label: session?.lineRole === 'branch' ? '支线进行中' : '进行中',
      tone: 'active',
    };
  }

  function getCurrentSessionCardHtml() {
    const currentSession = payload?.currentSession || null;
    if (!currentSession) {
      return `
        <div class="output-panel-empty-inline">
          当前没有 session 上下文，面板会优先显示整体产出结构。
        </div>
      `;
    }

    const workflowInfo = getWorkflowInfo(currentSession);
    const checkpoint = String(currentSession?.checkpoint || '').trim();
    const knownConclusionsCount = Number.isFinite(currentSession?.knownConclusionsCount)
      ? currentSession.knownConclusionsCount
      : 0;
    const updatedAt = formatStamp(currentSession?.updatedAt || '');
    const overview = String(currentSession?.overview || '').trim();

    return `
      <div class="output-panel-current">
        <div class="output-panel-current-top">
          <div class="output-panel-current-title">${escapeHtml(currentSession?.title || '当前任务')}</div>
          <span class="output-panel-status-badge is-${escapeHtml(workflowInfo.tone)}">${escapeHtml(workflowInfo.label)}</span>
        </div>
        ${overview ? `<div class="output-panel-current-subtitle">${escapeHtml(overview)}</div>` : ''}
        ${checkpoint ? `<div class="output-panel-current-checkpoint">${escapeHtml(checkpoint)}</div>` : ''}
        <div class="output-panel-current-meta">
          <span>已沉淀结论 ${escapeHtml(formatCount(knownConclusionsCount))}</span>
          ${updatedAt ? `<span>最近更新 ${escapeHtml(updatedAt)}</span>` : ''}
        </div>
      </div>
    `;
  }

  function renderFlowChart(items = [], week = {}, overview = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      return `<div class="output-panel-empty-inline">最近 7 天还没有足够的任务开关信号。</div>`;
    }
    const safeItems = items.map((entry) => ({
      label: String(entry?.label || '--').trim() || '--',
      openPool: Number.isFinite(entry?.endOpenSessions) ? Math.max(0, entry.endOpenSessions) : 0,
      completed: Number.isFinite(entry?.completedSessions) ? Math.max(0, entry.completedSessions) : 0,
      resolved: Number.isFinite(entry?.resolvedBranches) ? Math.max(0, entry.resolvedBranches) : 0,
    }));
    const width = 360;
    const height = 200;
    const top = 12;
    const bottom = 34;
    const left = 8;
    const right = 8;
    const plotHeight = height - top - bottom;
    const plotWidth = width - left - right;
    const maxValue = Math.max(
      1,
      ...safeItems.flatMap((entry) => [entry.openPool, entry.completed, entry.resolved]),
    );
    const step = plotWidth / safeItems.length;
    const barWidth = Math.max(6, Math.min(12, Math.floor((step - 10) / 2)));
    const barGap = 4;
    const clusterWidth = (barWidth * 2) + barGap;
    const baselineY = top + plotHeight;
    const gridMarkup = [0.25, 0.5, 0.75, 1].map((ratio) => {
      const y = top + (plotHeight * (1 - ratio));
      return `<line class="output-chart-grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line>`;
    }).join('');
    const poolPoints = safeItems.map((entry, index) => {
      const centerX = left + (step * index) + (step / 2);
      const openPoolHeight = (entry.openPool / maxValue) * plotHeight;
      const y = baselineY - openPoolHeight;
      return { centerX, y };
    });
    const poolPath = poolPoints
      .map((point) => `${point.centerX},${point.y}`)
      .join(' ');
    const poolMarkers = poolPoints
      .map((point) => `<circle class="output-chart-point is-pool" cx="${point.centerX}" cy="${point.y}" r="3.5"></circle>`)
      .join('');
    const barMarkup = safeItems.map((entry, index) => {
      const centerX = left + (step * index) + (step / 2);
      const groupX = centerX - (clusterWidth / 2);
      const completedHeight = (entry.completed / maxValue) * plotHeight;
      const resolvedHeight = (entry.resolved / maxValue) * plotHeight;
      return `
        <g class="output-chart-group">
          <rect class="output-chart-bar is-completed" x="${groupX}" y="${baselineY - completedHeight}" width="${barWidth}" height="${completedHeight}"></rect>
          <rect class="output-chart-bar is-resolved" x="${groupX + barWidth + barGap}" y="${baselineY - resolvedHeight}" width="${barWidth}" height="${resolvedHeight}"></rect>
          <text class="output-chart-day-label" x="${centerX}" y="${height - 10}" text-anchor="middle">${escapeHtml(entry.label)}</text>
        </g>
      `;
    }).join('');

    return `
      <div class="output-chart-shell">
        <svg class="output-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="最近 7 天任务池与收口趋势图">
          ${gridMarkup}
          <line class="output-chart-baseline" x1="${left}" y1="${baselineY}" x2="${width - right}" y2="${baselineY}"></line>
          <polyline class="output-chart-line is-pool" points="${poolPath}"></polyline>
          ${barMarkup}
          ${poolMarkers}
        </svg>
        <div class="output-chart-legend">
          <span class="output-chart-legend-item"><span class="output-chart-swatch is-pool"></span>在开任务池</span>
          <span class="output-chart-legend-item"><span class="output-chart-swatch is-completed"></span>完成</span>
          <span class="output-chart-legend-item"><span class="output-chart-swatch is-resolved"></span>收束</span>
        </div>
        <div class="output-chart-summary">
          <div class="output-chart-stat">
            <span class="output-chart-stat-label">当前在开</span>
            <span class="output-chart-stat-value">${escapeHtml(formatCount(overview.openSessions))}</span>
          </div>
          <div class="output-chart-stat">
            <span class="output-chart-stat-label">本周完成</span>
            <span class="output-chart-stat-value">${escapeHtml(formatCount(week.completedSessions))}</span>
          </div>
          <div class="output-chart-stat">
            <span class="output-chart-stat-label">本周收束</span>
            <span class="output-chart-stat-value">${escapeHtml(formatCount(week.resolvedBranches))}</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderBalanceChart(week = {}, today = {}, overview = {}) {
    const currentOpen = Number.isFinite(overview?.openSessions) ? Math.max(0, overview.openSessions) : 0;
    const weekClosed = Number.isFinite(week?.closedSessions) ? Math.max(0, week.closedSessions) : 0;
    const digestionRate = (currentOpen > 0 || weekClosed > 0)
      ? (weekClosed / Math.max(1, currentOpen + weekClosed))
      : 0;
    const gaugePercent = Math.max(0, Math.min(100, Math.round(digestionRate * 100)));
    const radius = 44;
    const circumference = 2 * Math.PI * radius;
    const dash = (circumference * gaugePercent) / 100;
    const railTotal = Math.max(1, currentOpen + weekClosed);
    const openWidth = (currentOpen / railTotal) * 100;
    const closedWidth = (weekClosed / railTotal) * 100;
    const toneClass = Number.isFinite(week?.netOpenDelta) && week.netOpenDelta < 0
      ? 'is-converging'
      : (Number.isFinite(week?.netOpenDelta) && week.netOpenDelta > 0 ? 'is-expanding' : 'is-flat');

    return `
      <div class="output-balance-shell ${toneClass}">
        <div class="output-gauge-wrap">
          <svg class="output-gauge-svg" viewBox="0 0 120 120" role="img" aria-label="7 日消化占比 ${escapeHtml(formatPercent(digestionRate))}">
            <circle class="output-gauge-track" cx="60" cy="60" r="${radius}"></circle>
            <circle class="output-gauge-fill" cx="60" cy="60" r="${radius}" transform="rotate(-90 60 60)" style="stroke-dasharray:${dash} ${circumference - dash}"></circle>
          </svg>
          <div class="output-gauge-center">
            <div class="output-gauge-value">${escapeHtml(formatPercent(digestionRate))}</div>
            <div class="output-gauge-label">7 日消化占比</div>
          </div>
        </div>
        <div class="output-balance-copy">
          <div class="output-balance-headline">${escapeHtml(formatPoolDelta(week.netOpenDelta))}</div>
          <div class="output-balance-desc">本周有效收口 ${escapeHtml(formatCount(week.closedSessions))} 条，当前在开 ${escapeHtml(formatCount(overview.openSessions))} 条。</div>
          <div class="output-balance-rail" aria-hidden="true">
            <span class="output-balance-rail-segment is-pool" style="width:${openWidth}%"></span>
            <span class="output-balance-rail-segment is-closed" style="width:${closedWidth}%"></span>
          </div>
          <div class="output-chart-legend">
            <span class="output-chart-legend-item"><span class="output-chart-swatch is-pool"></span>当前在开 ${escapeHtml(formatCount(currentOpen))}</span>
            <span class="output-chart-legend-item"><span class="output-chart-swatch is-closed"></span>本周收口 ${escapeHtml(formatCount(weekClosed))}</span>
          </div>
          <div class="output-balance-stat-list">
            <div class="output-balance-stat-row">
              <span>今日变化</span>
              <strong>${escapeHtml(formatPoolDelta(today.netOpenDelta))}</strong>
            </div>
            <div class="output-balance-stat-row">
              <span>等待输入</span>
              <strong>${escapeHtml(formatCount(overview.waitingSessions))}</strong>
            </div>
            <div class="output-balance-stat-row">
              <span>主线 / 支线</span>
              <strong>${escapeHtml(formatCount(overview.activeMainSessions))} / ${escapeHtml(formatCount(overview.activeBranchSessions))}</strong>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderListItems(items = [], emptyText = '暂无') {
    if (!Array.isArray(items) || items.length === 0) {
      return `<div class="output-panel-empty-inline">${escapeHtml(emptyText)}</div>`;
    }
    return items.map((entry) => {
      const stamp = formatStamp(entry?.at || entry?.updatedAt || '');
      return `
        <article class="output-list-item">
          <div class="output-list-item-title">${escapeHtml(entry?.title || '未命名项')}</div>
          <div class="output-list-item-detail">${escapeHtml(entry?.detail || '')}</div>
          ${stamp ? `<div class="output-list-item-time">${escapeHtml(stamp)}</div>` : ''}
        </article>
      `;
    }).join('');
  }

  function renderLoaded() {
    const scope = String(payload?.scope || '').trim() === 'long-term' ? 'long-term' : 'sessions';
    const scopeTitle = scope === 'long-term' ? '长期任务' : '普通任务';
    const overview = payload?.overview || {};
    const today = payload?.today || {};
    const week = payload?.week || {};
    const trend = Array.isArray(payload?.trend) ? payload.trend : [];
    const recentWins = Array.isArray(payload?.recentWins) ? payload.recentWins : [];
    const attention = Array.isArray(payload?.attention) ? payload.attention : [];
    const generatedAt = formatStamp(payload?.generatedAt || '');

    bodyEl.innerHTML = `
      <div class="output-panel-shell">
        <section class="output-panel-section">
          <div class="output-panel-kicker">
            当前口径：${escapeHtml(scopeTitle)}。核心看任务的流入、流出和任务池变化，让图表直接说明你是在堆积还是在收敛。
            ${generatedAt ? `最近刷新：${escapeHtml(generatedAt)}` : ''}
          </div>
        </section>

        <section class="output-panel-section output-panel-section-split">
          <div class="output-panel-card">
            <div class="output-panel-section-title">${scope === 'long-term' ? '长期维护流动' : '任务流动总览'}</div>
            <div class="output-panel-section-desc">${scope === 'long-term'
              ? '按天看长期任务线里的在开池、完成和支线收束，避免和普通任务混在一起。'
              : '按天看在开任务池、完成和支线收束，先判断这周是在积压还是在消化。'}</div>
            ${renderFlowChart(trend, week, overview)}
          </div>
          <div class="output-panel-card">
            <div class="output-panel-section-title">${scope === 'long-term' ? '维护池收敛' : '任务池收敛'}</div>
            <div class="output-panel-section-desc">${scope === 'long-term'
              ? '直接对比长期维护线本周收口和当前在开，判断这条长期线是在扩张还是在消化。'
              : '直接对比本周收口和当前在开，避免被新开噪声带偏。'}</div>
            ${renderBalanceChart(week, today, overview)}
          </div>
        </section>

        <section class="output-panel-section output-panel-section-split">
          <div class="output-panel-card">
            <div class="output-panel-section-title">当前任务快照</div>
            <div class="output-panel-section-desc">${escapeHtml(overview.loadLabel || '可控')}：${escapeHtml(overview.loadHint || '')}</div>
            ${getCurrentSessionCardHtml()}
          </div>
          <div class="output-panel-card">
            <div class="output-panel-section-title">最近收获</div>
            <div class="output-panel-section-desc">优先看真正收口的任务和已经收束的支线。</div>
            <div class="output-list">${renderListItems(recentWins, '最近还没有明显收口的任务。')}</div>
          </div>
        </section>

        <section class="output-panel-section">
          <div class="output-panel-card">
            <div class="output-panel-section-title">需要你处理</div>
            <div class="output-panel-section-desc">这里优先显示等待你输入，或已经放置过久的任务。</div>
            <div class="output-list">${renderListItems(attention, '当前没有明显等待项。')}</div>
          </div>
        </section>
      </div>
    `;
  }

  function render() {
    if (loading) {
      bodyEl.innerHTML = '<div class="output-panel-inline-loading">加载中…</div>';
      return;
    }
    if (errorMessage) {
      bodyEl.innerHTML = `<div class="output-panel-inline-error">${escapeHtml(errorMessage)}</div>`;
      return;
    }
    if (!payload) {
      bodyEl.innerHTML = '<div class="output-panel-inline-empty">暂无产出数据。</div>';
      return;
    }
    renderLoaded();
  }

  function abortInFlightRequest() {
    if (!activeRequestController) return;
    try {
      activeRequestController.abort();
    } catch {}
    activeRequestController = null;
  }

  async function refresh() {
    if (refreshPromise) {
      return refreshPromise;
    }
    const sessionId = getCurrentSessionId();
    const scope = getCurrentScope();
    lastContextKey = `${scope}::${sessionId}`;
    loading = true;
    errorMessage = '';
    render();
    refreshPromise = (async () => {
      const requestController = typeof global.AbortController === 'function'
        ? new global.AbortController()
        : null;
      activeRequestController = requestController;
      try {
        const response = await global.fetch(buildOutputPanelUrl(sessionId, scope), {
          credentials: 'same-origin',
          signal: requestController?.signal,
        });
        if (!response?.ok) {
          throw new Error('产出面板加载失败');
        }
        payload = await response.json().catch(() => null);
        if (!payload || typeof payload !== 'object') {
          throw new Error('产出数据格式无效');
        }
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }
        errorMessage = error?.message || '产出面板加载失败';
      } finally {
        if (activeRequestController === requestController) {
          activeRequestController = null;
        }
        loading = false;
        refreshPromise = null;
        render();
      }
    })();
    return refreshPromise;
  }

  function stopLiveRefresh() {
    if (refreshTimer) {
      global.clearTimeout?.(refreshTimer);
      refreshTimer = null;
    }
    if (liveRefreshTimer) {
      global.clearInterval?.(liveRefreshTimer);
      liveRefreshTimer = null;
    }
    if (contextPollTimer) {
      global.clearInterval?.(contextPollTimer);
      contextPollTimer = null;
    }
  }

  function scheduleRefresh(delayMs = 1200) {
    if (refreshTimer) {
      global.clearTimeout?.(refreshTimer);
      refreshTimer = null;
    }
    refreshTimer = global.setTimeout?.(() => {
      refreshTimer = null;
      if (!inlineEl.hidden) {
        void refresh();
      }
    }, delayMs) || null;
  }

  function startLiveRefresh() {
    stopLiveRefresh();
    liveRefreshTimer = global.setInterval?.(() => {
      if (inlineEl.hidden) return;
      void refresh();
    }, 15000) || null;
    contextPollTimer = global.setInterval?.(() => {
      if (inlineEl.hidden) return;
      const nextContextKey = getCurrentContextKey();
      if (nextContextKey === lastContextKey) return;
      lastContextKey = nextContextKey;
      abortInFlightRequest();
      scheduleRefresh(120);
    }, 700) || null;
  }

  // Inline panel: show when a session is active, hide on empty state
  function show() {
    inlineEl.hidden = false;
    startLiveRefresh();
    void refresh();
  }

  function hide() {
    inlineEl.hidden = true;
    stopLiveRefresh();
    abortInFlightRequest();
  }

  // Legacy open/close kept for any external callers
  function open() { show(); }
  function close() { hide(); }

  refreshButtonEl.addEventListener('click', () => {
    void refresh();
  });

  global.addEventListener?.('popstate', () => {
    if (inlineEl.hidden) return;
    abortInFlightRequest();
    scheduleRefresh(120);
  });

  // Auto-show: start live refresh immediately (panel is always visible when session is active)
  show();

  global.MelodySyncOutputPanel = Object.freeze({
    open,
    close,
    show,
    hide,
    refresh,
  });
})(window);
