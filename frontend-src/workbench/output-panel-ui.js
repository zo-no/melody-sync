(function outputPanelUiModule(global) {
  const documentRef = global.document;
  const overlayEl = documentRef?.getElementById?.('outputPanelOverlay');
  const openButtonEl = documentRef?.getElementById?.('outputPanelBtn');
  const closeButtonEl = documentRef?.getElementById?.('outputPanelClose');
  const refreshButtonEl = documentRef?.getElementById?.('outputPanelRefreshBtn');
  const bodyEl = documentRef?.getElementById?.('outputPanelBody');

  if (!overlayEl || !openButtonEl || !closeButtonEl || !refreshButtonEl || !bodyEl) {
    return;
  }

  let payload = null;
  let errorMessage = '';
  let loading = false;
  let refreshTimer = null;

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

  function formatScore(value) {
    const score = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
    return `${score}`;
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

  function getQuestState() {
    return global.MelodySyncWorkbenchViewModel?.getState?.()?.questState || null;
  }

  function getCurrentSessionCardHtml() {
    const questState = getQuestState();
    if (!questState?.hasSession || !questState?.session) {
      return `
        <div class="output-panel-empty-inline">
          当前没有聚焦中的任务，会优先显示整体产出结构。
        </div>
      `;
    }

    const session = questState.session || {};
    const taskCard = questState.taskCard || session.taskCard || {};
    const workflowModel = global.MelodySyncSessionStateModel || null;
    const workflowInfo = typeof workflowModel?.getWorkflowStatusInfo === 'function'
      ? workflowModel.getWorkflowStatusInfo(session.workflowState || '')
      : null;
    const statusLabel = String(
      workflowInfo?.label
      || (questState.isBranch ? '支线进行中' : '进行中'),
    ).trim();
    const statusTone = String(workflowInfo?.key || session.workflowState || '').trim().replace(/_/g, '-').toLowerCase() || 'active';
    const checkpoint = String(taskCard?.checkpoint || questState.nextStep || '').trim();
    const knownConclusionsCount = Array.isArray(taskCard?.knownConclusions)
      ? taskCard.knownConclusions.filter((entry) => String(entry || '').trim()).length
      : 0;
    const updatedAt = formatStamp(session.updatedAt || session.lastEventAt || session.createdAt || session.created || '');
    const overview = String(
      questState.isBranch
        ? (questState.activeBranchChain || questState.branchFrom || questState.mainGoal || '')
        : (questState.mainOverview || questState.mainGoal || ''),
    ).trim();

    return `
      <div class="output-panel-current">
        <div class="output-panel-current-top">
          <div class="output-panel-current-title">${escapeHtml(questState.currentGoal || session.name || '当前任务')}</div>
          <span class="output-panel-status-badge is-${escapeHtml(statusTone)}">${escapeHtml(statusLabel)}</span>
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

  function renderMetricCard(label, value, meta, tone = '') {
    return `
      <article class="output-metric-card${tone ? ` is-${escapeHtml(tone)}` : ''}">
        <div class="output-metric-label">${escapeHtml(label)}</div>
        <div class="output-metric-value">${escapeHtml(value)}</div>
        <div class="output-metric-meta">${escapeHtml(meta)}</div>
      </article>
    `;
  }

  function renderTrendRows(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
      return `<div class="output-panel-empty-inline">最近 7 天还没有足够的推进信号。</div>`;
    }
    return items.map((entry) => {
      const score = Number.isFinite(entry?.score) ? Math.max(0, Math.min(100, Math.round(entry.score))) : 0;
      const touched = Number.isFinite(entry?.touchedSessions) ? entry.touchedSessions : 0;
      const completed = Number.isFinite(entry?.completedSessions) ? entry.completedSessions : 0;
      const resolved = Number.isFinite(entry?.resolvedBranches) ? entry.resolvedBranches : 0;
      return `
        <div class="output-trend-row">
          <div class="output-trend-label">${escapeHtml(entry?.label || '--')}</div>
          <div class="output-trend-bar">
            <div class="output-trend-fill" style="width:${score}%"></div>
          </div>
          <div class="output-trend-meta">分 ${escapeHtml(formatScore(score))} · 推进 ${escapeHtml(formatCount(touched))} · 完成 ${escapeHtml(formatCount(completed))} · 收束 ${escapeHtml(formatCount(resolved))}</div>
        </div>
      `;
    }).join('');
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
            衡量的是完成、收束、聚焦和等待，不把聊天条数当作产出。
            ${generatedAt ? `最近刷新：${escapeHtml(generatedAt)}` : ''}
          </div>
          <div class="output-panel-metric-grid">
            ${renderMetricCard('本周执行分', formatScore(week.score), `完成 ${formatCount(week.completedSessions)} · 收束 ${formatCount(week.resolvedBranches)}`, 'score')}
            ${renderMetricCard('今日执行分', formatScore(today.score), `推进 ${formatCount(today.touchedSessions)} · 结构化 ${formatCount(today.structuredSessions)}`, 'day')}
            ${renderMetricCard('当前聚焦度', formatScore(overview.focusScore), `${formatCount(overview.activeMainSessions)} 条主线 · ${formatCount(overview.activeBranchSessions)} 条支线`, 'focus')}
            ${renderMetricCard('等待你处理', formatCount(overview.waitingSessions), `停放 ${formatCount(overview.parkedSessions)}`, 'waiting')}
          </div>
        </section>

        <section class="output-panel-section output-panel-section-split">
          <div class="output-panel-card">
            <div class="output-panel-section-title">最近 7 天趋势</div>
            <div class="output-panel-section-desc">每天的执行分由完成、收束和结构化推进共同组成。</div>
            <div class="output-trend-list">${renderTrendRows(trend)}</div>
          </div>
          <div class="output-panel-card">
            <div class="output-panel-section-title">当前任务快照</div>
            <div class="output-panel-section-desc">${escapeHtml(overview.focusLabel || '可控')}：${escapeHtml(overview.focusHint || '')}</div>
            ${getCurrentSessionCardHtml()}
          </div>
        </section>

        <section class="output-panel-section output-panel-section-split">
          <div class="output-panel-card">
            <div class="output-panel-section-title">最近收获</div>
            <div class="output-panel-section-desc">优先看真正收口的任务和已经收束的支线。</div>
            <div class="output-list">${renderListItems(recentWins, '最近还没有明显收口的任务。')}</div>
          </div>
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
      bodyEl.innerHTML = '<div class="hooks-loading">产出面板加载中…</div>';
      return;
    }
    if (errorMessage) {
      bodyEl.innerHTML = `<div class="hooks-error">${escapeHtml(errorMessage)}</div>`;
      return;
    }
    if (!payload) {
      bodyEl.innerHTML = '<div class="hooks-empty">还没有可展示的产出数据。</div>';
      return;
    }
    renderLoaded();
  }

  async function refresh() {
    loading = true;
    errorMessage = '';
    render();
    try {
      const response = await global.fetch('/api/workbench/output-metrics', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response?.ok) {
        throw new Error('产出面板加载失败');
      }
      payload = await response.json().catch(() => null);
      if (!payload || typeof payload !== 'object') {
        throw new Error('产出数据格式无效');
      }
    } catch (error) {
      errorMessage = error?.message || '产出面板加载失败';
    } finally {
      loading = false;
      render();
    }
  }

  function scheduleRefresh(delayMs = 1200) {
    if (refreshTimer) {
      global.clearTimeout?.(refreshTimer);
      refreshTimer = null;
    }
    refreshTimer = global.setTimeout?.(() => {
      refreshTimer = null;
      if (!overlayEl.hidden) {
        void refresh();
      }
    }, delayMs) || null;
  }

  function open() {
    overlayEl.hidden = false;
    documentRef.body?.classList?.add?.('output-panel-open');
    void refresh();
  }

  function close() {
    overlayEl.hidden = true;
    documentRef.body?.classList?.remove?.('output-panel-open');
  }

  openButtonEl.addEventListener('click', () => {
    open();
  });

  closeButtonEl.addEventListener('click', () => {
    close();
  });

  refreshButtonEl.addEventListener('click', () => {
    void refresh();
  });

  overlayEl.addEventListener('click', (event) => {
    if (event?.target === overlayEl) {
      close();
    }
  });

  documentRef.addEventListener('keydown', (event) => {
    if (event?.key === 'Escape' && !overlayEl.hidden) {
      close();
    }
  });

  try {
    global.MelodySyncWorkbenchViewModel?.subscribe?.(() => {
      if (overlayEl.hidden) return;
      render();
      scheduleRefresh(900);
    }, { immediate: false });
  } catch {}

  render();

  global.MelodySyncOutputPanel = Object.freeze({
    open,
    close,
    refresh,
  });
})(window);
