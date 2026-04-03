(function workbenchModule() {
  const tracker = document.getElementById("questTracker");
  const trackerStatusEl = document.getElementById("questTrackerStatus");
  const trackerStatusDotEl = document.getElementById("questTrackerStatusDot");
  const trackerStatusTextEl = document.getElementById("questTrackerStatusText");
  const trackerTitleEl = document.getElementById("questTrackerTitle");
  const trackerBranchEl = document.getElementById("questTrackerBranch");
  const trackerBranchLabelEl = document.getElementById("questTrackerBranchLabel");
  const trackerBranchTitleEl = document.getElementById("questTrackerBranchTitle");
  const trackerNextEl = document.getElementById("questTrackerNext");
  const trackerTimeEl = document.getElementById("questTrackerTime");
  const trackerTaskListEl = document.getElementById("questTaskList");
  const taskMapRail = document.getElementById("taskMapRail");
  const taskMapDrawerBtn = document.getElementById("taskMapDrawerBtn");
  const taskMapDrawerBackdrop = document.getElementById("taskMapDrawerBackdrop");
  const trackerFooterEl = document.getElementById("questTrackerFooter");
  const trackerActionsEl = document.getElementById("questTrackerActions");
  const trackerToggleBtn = document.getElementById("questTrackerToggleBtn");
  const trackerCloseBtn = document.getElementById("questTrackerCloseBtn");
  const trackerAltBtn = document.getElementById("questTrackerAltBtn");
  const trackerBackBtn = document.getElementById("questTrackerBackBtn");
  const trackerDetailEl = document.getElementById("questTrackerDetail");
  const trackerDetailToggleBtn = document.getElementById("questTrackerDetailToggle");
  const trackerGoalRowEl = document.getElementById("questTrackerGoalRow");
  const trackerGoalValEl = document.getElementById("questTrackerGoalVal");
  const trackerConclusionsRowEl = document.getElementById("questTrackerConclusionsRow");
  const trackerConclusionsListEl = document.getElementById("questTrackerConclusionsList");
  const trackerMemoryRowEl = document.getElementById("questTrackerMemoryRow");
  const trackerMemoryListEl = document.getElementById("questTrackerMemoryList");
  if (!tracker) return;

  const SUPPRESSED_PREFIX = "melodysyncSuppressedBranch";
  const TASK_MAP_MOCK_STORAGE_KEY = "melodysyncTaskMapMockPreset";

  let snapshot = {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    taskClusters: [],
    skills: [],
    summaries: [],
  };
  let refreshInFlight = null;
  let trackerRefreshInFlight = null;
  let fullSnapshotRefreshTimer = null;
  let taskMapExpanded = !isMobileQuestTracker();
  let lastTaskMapViewportMode = isMobileQuestTracker() ? "mobile" : "desktop";
  let questHasSessionTracked = false;
  let focusedSessionId = "";
  let branchActionController = null;
  let trackerDetailExpanded = false;
  let taskMapFlowRenderer = null;
  let taskListController = null;
  let questStateSelector = null;
  let trackerRenderer = null;
  let operationRecordController = null;

  function translate(key, vars) {
    return typeof window?.melodySyncT === "function" ? window.melodySyncT(key, vars) : key;
  }

  function renderWorkbenchIcon(name, className = "") {
    return window.MelodySyncIcons?.render(name, { className }) || "";
  }

  function clipText(value, max = 120) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }

  function normalizeTitle(value) {
    return clipText(value, 96);
  }

  function toConciseGoal(value, max = 48) {
    const compact = String(value || "").replace(/\s+/g, " ").trim();
    if (!compact) return "";
    const firstSegment = compact
      .split(/[。！？.!?\n]/)
      .map((entry) => entry.trim())
      .find(Boolean);
    return clipText(firstSegment || compact, max);
  }

  function toTaskBarSummary(value, max = 10) {
    const compact = String(value || "").replace(/\s+/g, " ").trim();
    if (!compact) return "";
    const firstSegment = compact
      .split(/[。！？.!?\n]/)
      .map((entry) => entry.trim())
      .find(Boolean);
    const title = String(firstSegment || compact).trim();
    if (!title) return "";
    return title.length > max ? title.slice(0, max).trim() : title;
  }

  function normalizeComparableText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/[：:·•，。,.;；、!?！？]/g, "")
      .trim()
      .toLowerCase();
  }

  function isRedundantTrackerText(value, ...comparisons) {
    const base = normalizeComparableText(value);
    if (!base) return true;
    return comparisons.some((entry) => {
      const candidate = normalizeComparableText(entry);
      return candidate && candidate === base;
    });
  }

  function renderChevronIcon(expanded, className = "") {
    const icon = renderWorkbenchIcon(
      expanded ? "chevron-down" : "chevron-right",
      className,
    );
    if (icon) return icon;
    return expanded ? "▾" : "▸";
  }

  function setTaskMapButtonContent(button, expanded) {
    if (!button) return;
    button.innerHTML = `
      <span class="quest-tracker-toggle-label">地图</span>
      <span class="quest-tracker-toggle-icon">${renderChevronIcon(expanded, "quest-tracker-toggle-svg")}</span>
    `;
  }

  function isMobileTaskMapDrawerOpen() {
    return isMobileQuestTracker() && taskMapExpanded === true;
  }

  function isTaskMapExpanded() {
    return taskMapExpanded === true;
  }

  function renderTrackerStatus(state) {
    trackerRenderer?.renderStatus(state);
  }

  function setTaskMapDrawerExpanded(expanded, options = {}) {
    const nextExpanded = expanded === true;
    const currentExpanded = isTaskMapExpanded();
    if (currentExpanded === nextExpanded && options.force !== true) {
      if (options.render === true) renderTracker();
      return;
    }
    taskMapExpanded = nextExpanded;
    if (typeof requestLayoutPass === "function") {
      requestLayoutPass("task-map-toggle");
    }
    if (options.render !== false) {
      renderTracker();
    }
  }

  function collapseTaskMapAfterAction(options = {}) {
    if (!isMobileQuestTracker()) return;
    setTaskMapDrawerExpanded(false, options);
  }

  function syncTaskMapDrawerUi(isMounted) {
    const mobileDrawer = isMobileQuestTracker();
    const shouldMount = Boolean(isMounted);
    const mapExpanded = shouldMount && isTaskMapExpanded();
    const drawerOpen = mapExpanded && mobileDrawer;
    const desktopCollapsed = shouldMount && !mobileDrawer && !mapExpanded;
    if (taskMapRail) {
      taskMapRail.classList.toggle("is-mobile-drawer", mobileDrawer && shouldMount);
      taskMapRail.classList.remove("is-desktop-drawer", "is-drawer-open");
      taskMapRail.classList.toggle("is-mobile-open", drawerOpen);
      taskMapRail.classList.toggle("is-collapsed", desktopCollapsed);
      taskMapRail.setAttribute("aria-hidden", mapExpanded ? "false" : "true");
    }
    if (taskMapDrawerBackdrop) {
      taskMapDrawerBackdrop.hidden = !(mobileDrawer && shouldMount && drawerOpen);
    }
    if (taskMapDrawerBtn) {
      taskMapDrawerBtn.hidden = !shouldMount;
      taskMapDrawerBtn.setAttribute("aria-expanded", mapExpanded ? "true" : "false");
      taskMapDrawerBtn.title = mapExpanded ? "收起任务地图" : "展开任务地图";
      taskMapDrawerBtn.setAttribute("aria-label", taskMapDrawerBtn.title);
      setTaskMapButtonContent(taskMapDrawerBtn, mapExpanded);
    }
    if (trackerToggleBtn) {
      trackerToggleBtn.hidden = true;
    }
    document.body?.classList?.toggle?.("task-map-drawer-open", drawerOpen);
    document.body?.classList?.toggle?.("task-map-is-collapsed", desktopCollapsed);
  }

  function getTrackerPrimaryTitle(state) {
    return trackerRenderer?.getPrimaryTitle(state) || "当前任务";
  }

  function getTrackerPrimaryDetail(state) {
    return trackerRenderer?.getPrimaryDetail(state) || "";
  }

  function getTrackerSecondaryDetail(state, primaryDetail = "") {
    return trackerRenderer?.getSecondaryDetail(state, primaryDetail) || "";
  }

  function isMobileQuestTracker() {
    const viewportWidth = Number(window?.innerWidth || 0);
    return viewportWidth > 0 && viewportWidth <= 767;
  }

  questStateSelector = window.MelodySyncQuestState?.createSelector?.({
    getSnapshot: () => snapshot,
    getCurrentSession: getCurrentSessionSafe,
    getFocusedSession: getFocusedSessionRecord,
    getSessionRecord,
    normalizeSessionId,
    normalizeTitle,
    toTaskBarSummary,
    clipText,
    shouldHideTrackerNext,
    getTaskCard,
    getTaskCardList,
    isSessionAwaitingFirstMessage,
    getResolvedClusterCurrentBranchSessionId,
    getSessionDisplayName,
    getBranchDisplayName,
  }) || {
    deriveQuestState() {
      return { hasSession: false };
    },
    getClusterTitle() {
      return "";
    },
    getCurrentTaskSummary() {
      return "";
    },
  };

  trackerRenderer = window.MelodySyncTaskTrackerUi?.createTrackerRenderer?.({
    trackerStatusEl,
    trackerStatusDotEl,
    trackerStatusTextEl,
    trackerDetailEl,
    trackerDetailToggleBtn,
    trackerGoalRowEl,
    trackerGoalValEl,
    trackerConclusionsRowEl,
    trackerConclusionsListEl,
    trackerMemoryRowEl,
    trackerMemoryListEl,
    clipText,
    toConciseGoal,
    isMobileQuestTracker,
    isRedundantTrackerText,
    getCurrentTaskSummary: (state) => questStateSelector?.getCurrentTaskSummary?.(state) || "",
    getBranchDisplayName,
    getSessionVisualStatus: typeof getSessionVisualStatus === "function" ? getSessionVisualStatus : null,
  }) || {
    renderStatus() {},
    getPrimaryTitle() { return "当前任务"; },
    getPrimaryDetail() { return ""; },
    getSecondaryDetail() { return ""; },
    renderDetail() {},
  };
  taskMapFlowRenderer = window.MelodySyncTaskMapUi?.createRenderer?.({
    isMobileQuestTracker,
    clipText,
    translate,
    getBranchStatusUi,
    collapseTaskMapAfterAction,
    enterBranchFromSession,
    getSessionRecord,
    attachSession,
  }) || {
    renderFlowBoard() {
      const empty = document.createElement("div");
      empty.className = "task-map-empty";
      empty.textContent = "暂无任务地图。";
      return empty;
    },
  };
  taskListController = window.MelodySyncTaskListUi?.createController?.({
    trackerTaskListEl,
    taskMapRail,
    clipText,
    translate,
    renderChevronIcon,
    isMobileQuestTracker,
    isTaskMapExpanded,
    syncTaskMapDrawerUi,
    collapseTaskMapAfterAction,
    attachSession,
    getTaskMapProjection,
    getResolvedClusterCurrentBranchSessionId,
    getTaskCard,
    getTaskCardList,
    getClusterTitle: (cluster) => questStateSelector?.getClusterTitle?.(cluster) || "",
    getBranchDisplayName,
    getBranchStatusUi,
    toConciseGoal,
    taskMapFlowRenderer,
    requestRender: renderTracker,
  }) || {
    invalidate() {},
    render() {},
  };

  function shouldHideTrackerNext(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return true;
    return [
      /等待用户.*决定/i,
      /等待用户.*提供/i,
      /保留还是撤回/i,
      /是否保留/i,
      /是否撤回/i,
      /等待.*确认/i,
      /继续当前任务/i,
    ].some((pattern) => pattern.test(text));
  }

  function stripBranchTitleNoise(value) {
    return String(value || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[#>*_[\\]-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getCurrentSessionSafe() {
    if (typeof getCurrentSession === "function") return getCurrentSession();
    return null;
  }

  function normalizeSessionId(value) {
    return String(value || "").trim();
  }

  function getCurrentSessionIdSafe() {
    return normalizeSessionId(getCurrentSessionSafe()?.id || "");
  }

  function getFocusedSessionId() {
    const normalizedFocused = normalizeSessionId(focusedSessionId);
    if (normalizedFocused) {
      if (normalizedFocused === getCurrentSessionIdSafe()) return normalizedFocused;
      if (getSessionRecord(normalizedFocused)) return normalizedFocused;
    }
    return getCurrentSessionIdSafe();
  }

  function getFocusedSessionRecord() {
    const sessionId = getFocusedSessionId();
    if (!sessionId) return null;
    return getSessionRecord(sessionId)
      || (getCurrentSessionSafe()?.id === sessionId ? getCurrentSessionSafe() : null);
  }

  function getClusterBranchSessionIds(cluster) {
    const ids = new Set();
    for (const sessionId of Array.isArray(cluster?.branchSessionIds) ? cluster.branchSessionIds : []) {
      const normalizedSessionId = normalizeSessionId(sessionId);
      if (normalizedSessionId) ids.add(normalizedSessionId);
    }
    for (const session of Array.isArray(cluster?.branchSessions) ? cluster.branchSessions : []) {
      const normalizedSessionId = normalizeSessionId(session?.id || "");
      if (normalizedSessionId) ids.add(normalizedSessionId);
    }
    return ids;
  }

  function getResolvedClusterCurrentBranchSessionId(cluster, preferredSessionId = "") {
    const resolvedCluster = cluster || null;
    if (!resolvedCluster) return "";
    const normalizedPreferredSessionId = normalizeSessionId(preferredSessionId || getFocusedSessionId());
    const rootSessionId = normalizeSessionId(resolvedCluster?.mainSessionId || "");
    if (normalizedPreferredSessionId) {
      if (normalizedPreferredSessionId === rootSessionId) return "";
      if (getClusterBranchSessionIds(resolvedCluster).has(normalizedPreferredSessionId)) {
        return normalizedPreferredSessionId;
      }
    }
    return normalizeSessionId(resolvedCluster?.currentBranchSessionId || "");
  }

  function applyFocusedSessionToSnapshot(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) return false;
    const clusters = Array.isArray(snapshot?.taskClusters) ? snapshot.taskClusters : [];
    for (const cluster of clusters) {
      const rootSessionId = normalizeSessionId(cluster?.mainSessionId || "");
      if (!rootSessionId) continue;
      if (normalizedSessionId === rootSessionId) {
        if (normalizeSessionId(cluster?.currentBranchSessionId || "")) {
          cluster.currentBranchSessionId = "";
          return true;
        }
        return false;
      }
      if (getClusterBranchSessionIds(cluster).has(normalizedSessionId)) {
        if (normalizeSessionId(cluster?.currentBranchSessionId || "") !== normalizedSessionId) {
          cluster.currentBranchSessionId = normalizedSessionId;
          return true;
        }
        return false;
      }
    }
    return false;
  }

  function setFocusedSessionId(sessionId, options = {}) {
    const nextFocusedSessionId = normalizeSessionId(sessionId) || getCurrentSessionIdSafe();
    const focusChanged = nextFocusedSessionId !== focusedSessionId;
    if (focusChanged) {
      questHasSessionTracked = false;
    }
    focusedSessionId = nextFocusedSessionId;
    const snapshotChanged = options.syncSnapshot === false
      ? false
      : applyFocusedSessionToSnapshot(nextFocusedSessionId);
    if ((focusChanged || snapshotChanged) && options.render !== false) {
      taskListController?.invalidate?.();
      renderTracker();
      if (options.renderSessionList === true && typeof renderSessionList === "function") {
        renderSessionList();
      }
    }
    if (focusChanged && operationRecordController?.isOpen?.()) {
      operationRecordController.handleFocusChange();
    }
    return focusedSessionId;
  }

  function getTaskMapMockPreset() {
    try {
      const href = String(window?.location?.href || "");
      if (href) {
        const url = new URL(href);
        const fromQuery = String(url.searchParams.get("taskMapMock") || "").trim();
        if (fromQuery) {
          return fromQuery;
        }
      }
    } catch {
    }
    try {
      return String(localStorage.getItem(TASK_MAP_MOCK_STORAGE_KEY) || "").trim();
    } catch {
      return "";
    }
  }

  function getTaskMapProjection() {
    if (typeof window?.MelodySyncTaskMapModel?.buildTaskMapProjection !== "function") {
      return null;
    }
    const projection = window.MelodySyncTaskMapModel.buildTaskMapProjection({
      snapshot,
      sessions: getSessionRecords(),
      currentSessionId: getCurrentSessionIdSafe(),
      focusedSessionId: getFocusedSessionId(),
    });
    if (typeof window?.MelodySyncTaskMapModel?.applyTaskMapMockPreset === "function") {
      return window.MelodySyncTaskMapModel.applyTaskMapMockPreset(projection, getTaskMapMockPreset());
    }
    return projection;
  }

  function getSessionRecords() {
    if (typeof sessions !== "undefined" && Array.isArray(sessions)) {
      return sessions;
    }
    if (Array.isArray(window.sessions)) {
      return window.sessions;
    }
    return [];
  }

  function getSessionRecord(sessionId) {
    if (!sessionId) return null;
    return getSessionRecords().find((entry) => entry.id === sessionId) || null;
  }

  function getSessionDisplayName(session) {
    const name = String(session?.name || "").trim();
    const goal = String(session?.taskCard?.goal || "").trim();
    const mainGoal = String(session?.taskCard?.mainGoal || "").trim();
    const isBranch = String(session?.taskCard?.lineRole || "").trim().toLowerCase() === "branch"
      || Boolean(String(session?.sourceContext?.parentSessionId || "").trim());
    return toConciseGoal(
      isBranch
        ? (goal || name || mainGoal || "当前任务")
        : (name || mainGoal || goal || "当前任务"),
      56,
    );
  }

  function getBranchDisplayName(session) {
    const raw = getSessionDisplayName(session);
    return raw.replace(/^(?:Branch\s*[·•-]\s*|支线\s*[·•:-]\s*)/i, "").trim() || raw;
  }

  function getTaskCard(session) {
    return session?.taskCard && typeof session.taskCard === "object" ? session.taskCard : null;
  }

  function getTaskCardList(taskCard, key) {
    return Array.isArray(taskCard?.[key])
      ? taskCard[key].filter((entry) => typeof entry === "string" && entry.trim())
      : [];
  }

  function isSessionAwaitingFirstMessage(session) {
    if (!session || typeof session !== "object") return false;
    const messageCount = Number.isInteger(session?.messageCount) ? session.messageCount : null;
    const latestSeq = Number.isInteger(session?.latestSeq) ? session.latestSeq : null;
    if (messageCount !== null) {
      return messageCount <= 0 && (latestSeq === null || latestSeq <= 0);
    }
    if (latestSeq !== null) {
      return latestSeq <= 0;
    }
    return true;
  }

  function formatTrackerTime(value) {
    if (!value) return "";
    const ts = new Date(typeof value === "number" ? value : value).getTime();
    if (!Number.isFinite(ts)) return "";
    const d = new Date(ts);
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const dy = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${mo}-${dy} ${hh}:${mm}`;
  }

  function getBranchStatusUi(branchStatus) {
    switch (String(branchStatus || "").toLowerCase()) {
      case "resolved":
        return { label: "已关闭", summary: "当前子任务已直接关闭，可稍后重新打开。" };
      case "parked":
        return { label: "已挂起", summary: "当前子任务已挂起，并已回到主线。" };
      case "merged":
        return { label: "已收束", summary: "当前子任务已收尾并带回主线。" };
      default:
        return { label: "进行中", summary: "" };
    }
  }

  function getSuppressedStorageKey(sessionId, branchTitle) {
    return `${SUPPRESSED_PREFIX}:${sessionId}:${String(branchTitle || "").trim().toLowerCase()}`;
  }

  function isSuppressed(sessionId, branchTitle) {
    if (!sessionId || !branchTitle) return false;
    const session = getSessionRecord(sessionId) || getCurrentSessionSafe();
    const persisted = Array.isArray(session?.suppressedBranchTitles)
      ? session.suppressedBranchTitles.some((entry) => String(entry || "").trim().toLowerCase() === String(branchTitle || "").trim().toLowerCase())
      : false;
    return persisted || localStorage.getItem(getSuppressedStorageKey(sessionId, branchTitle)) === "1";
  }

  function suppressCandidate(sessionId, branchTitle) {
    if (!sessionId || !branchTitle) return;
    localStorage.setItem(getSuppressedStorageKey(sessionId, branchTitle), "1");
  }

  function clearSuppressed(sessionId, branchTitle) {
    if (!sessionId || !branchTitle) return;
    localStorage.removeItem(getSuppressedStorageKey(sessionId, branchTitle));
  }

  function deriveBranchTitleFromText(value) {
    const text = clipText(stripBranchTitleNoise(value), 72);
    if (!text) return "继续这条支线";
    const firstSegment = text.split(/[。！？.!?\n]/).map((entry) => entry.trim()).find(Boolean);
    return normalizeTitle(firstSegment || text);
  }

  function replaceSessionRecord(nextSession) {
    if (!nextSession?.id) return;
    const records = getSessionRecords();
    if (Array.isArray(records)) {
      const index = records.findIndex((entry) => entry.id === nextSession.id);
      if (index !== -1) {
        records[index] = nextSession;
      } else {
        records.unshift(nextSession);
      }
    }
    if (typeof getCurrentSession === "function") {
      const current = getCurrentSession();
      if (current?.id === nextSession.id) {
        Object.assign(current, nextSession);
      }
    }
  }

  async function persistCandidateSuppression(sessionId, branchTitle, suppressed = true) {
    if (!sessionId || !branchTitle) return null;
    try {
      const response = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(sessionId)}/candidate-suppression`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchTitle,
          suppressed,
        }),
      });
      if (response?.session) {
        replaceSessionRecord(response.session);
      }
      if (response?.snapshot) {
        snapshot = response.snapshot;
      }
      return response;
    } catch (error) {
      console.warn("[quest] Failed to persist branch suppression:", error?.message || error);
      return null;
    }
  }

  function deriveQuestState() {
    return questStateSelector?.deriveQuestState?.() || { hasSession: false };
  }

  function getEmptyStateNode() {
    if (typeof emptyState !== "undefined" && emptyState) return emptyState;
    return document.getElementById("emptyState");
  }

  function syncQuestEmptyState(state) {
    const emptyNode = getEmptyStateNode();
    if (!emptyNode) return;

    if (!state?.hasSession) {
      questHasSessionTracked = false;
      document.body?.classList?.remove?.("workbench-has-session");
      emptyNode.hidden = true;
      emptyNode.classList.remove("quest-empty-state");
      return;
    }

    document.body?.classList?.add?.("workbench-has-session");
    emptyNode.hidden = true;
    emptyNode.classList.remove("quest-empty-state");
  }

  function scrollWorkbenchToTopIfNeeded(state) {
    if (!state?.hasSession || questHasSessionTracked) return;
    const messagesElement = typeof messagesEl !== "undefined" ? messagesEl : null;
    if (!messagesElement) return;
    questHasSessionTracked = true;
    if (typeof scrollCurrentSessionViewportToTop === "function") {
      scrollCurrentSessionViewportToTop();
      return;
    }
    requestAnimationFrame(() => {
      if (typeof messagesElement.scrollTo === "function") {
        messagesElement.scrollTo({
          top: 0,
          behavior: "auto",
        });
      } else {
        messagesElement.scrollTop = 0;
      }
    });
  }

  function renderTracker() {
    const state = deriveQuestState();
    // Keep suggested questions in sync with the current session state.
    if (typeof window.renderSuggestedQuestions === "function") {
      window.renderSuggestedQuestions(state.session || null);
    }
    if (!state.hasSession) {
      tracker.hidden = true;
      if (taskMapRail) taskMapRail.hidden = true;
      if (trackerTaskListEl) trackerTaskListEl.hidden = true;
      syncTaskMapDrawerUi(false);
      syncQuestEmptyState(state);
      return;
    }

    tracker.hidden = false;
    scrollWorkbenchToTopIfNeeded(state);
    syncQuestEmptyState(state);
    const showBranch = Boolean(state.isBranch && state.currentGoal);
    tracker.classList.toggle("is-branch-focus", showBranch);
    const branchStatus = String(state.branchStatus || "").toLowerCase();
    renderTrackerStatus(state);
    const trackerTitle = getTrackerPrimaryTitle(state);
    const trackerPrimaryDetail = getTrackerPrimaryDetail(state);
    const trackerSecondaryDetail = getTrackerSecondaryDetail(state, trackerPrimaryDetail);
    trackerTitleEl.textContent = trackerTitle;
    trackerTitleEl.hidden = false;
    if (trackerBranchEl) {
      trackerBranchEl.hidden = !trackerPrimaryDetail;
      trackerBranchLabelEl.textContent = showBranch ? "主线任务" : "当前推进";
      trackerBranchTitleEl.textContent = trackerPrimaryDetail;
    }
    trackerNextEl.hidden = !trackerSecondaryDetail;
    trackerNextEl.textContent = trackerSecondaryDetail;
    if (trackerTimeEl) {
      const sessionTime = state.session?.lastEventAt || state.session?.updatedAt || state.session?.created || "";
      const timeText = formatTrackerTime(sessionTime);
      trackerTimeEl.hidden = !timeText;
      trackerTimeEl.textContent = timeText;
    }
    if (trackerToggleBtn) {
      trackerToggleBtn.hidden = true;
    }
    trackerActionsEl?.classList.toggle("is-inline-links", Boolean(
      showBranch && (branchStatus === "active" || ["resolved", "merged", "parked"].includes(branchStatus))
    ));
    branchActionController?.syncTrackerButtons(state);
    taskListController?.render(state);
    renderTrackerDetail(state.session?.taskCard);
  }

  function renderTrackerDetail(taskCard) {
    trackerRenderer?.renderDetail(taskCard, trackerDetailExpanded);
  }

  function renderPathPanel() {
    // Path-cluster UI has been removed from the user-facing surface.
  }

  function mergeSnapshotPatch(patch) {
    if (!patch || typeof patch !== "object") return;
    if (Array.isArray(patch.branchContexts)) {
      snapshot.branchContexts = patch.branchContexts;
    }
    if (Array.isArray(patch.taskClusters)) {
      snapshot.taskClusters = patch.taskClusters;
    }
  }

  async function refreshTrackerSnapshot(sessionIdOverride = "") {
    const session = getCurrentSessionSafe();
    const targetSessionId = String(sessionIdOverride || getFocusedSessionId() || session?.id || "").trim();
    if (!targetSessionId) {
      renderTracker();
      return null;
    }
    if (trackerRefreshInFlight) return trackerRefreshInFlight;
    trackerRefreshInFlight = (async () => {
      try {
        const trackerSnapshot = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(targetSessionId)}/tracker`);
        mergeSnapshotPatch(trackerSnapshot);
      } catch {}
      renderTracker();
      renderPathPanel();
      trackerRefreshInFlight = null;
      return snapshot;
    })();
    return trackerRefreshInFlight;
  }

  async function refreshSnapshot() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        snapshot = await fetchJsonOrRedirect("/api/workbench");
      } catch {
        snapshot = {
          captureItems: [],
          projects: [],
          nodes: [],
          branchContexts: [],
          taskClusters: [],
          skills: [],
          summaries: [],
        };
      }
      renderTracker();
      renderPathPanel();
      refreshInFlight = null;
      return snapshot;
    })();
    return refreshInFlight;
  }

  function scheduleFullSnapshotRefresh(delayMs = 1200) {
    if (fullSnapshotRefreshTimer) {
      clearTimeout(fullSnapshotRefreshTimer);
    }
    const runner = () => {
      fullSnapshotRefreshTimer = null;
      void refreshSnapshot();
    };
    if (typeof window.setTimeout === "function") {
      fullSnapshotRefreshTimer = window.setTimeout(runner, delayMs);
    } else if (typeof setTimeout === "function") {
      fullSnapshotRefreshTimer = setTimeout(runner, delayMs);
    } else {
      runner();
    }
  }

  async function enterBranchFromSession(sessionId, branchTitle, options = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId || !branchTitle) return null;
    clearSuppressed(normalizedSessionId, branchTitle);
    void persistCandidateSuppression(normalizedSessionId, branchTitle, false);
    const response = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(normalizedSessionId)}/branches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal: branchTitle,
        branchReason: options.branchReason || "",
        checkpointSummary: options.checkpointSummary || "",
      }),
    });
    snapshot = response?.snapshot || snapshot;
    if (response?.session) {
      replaceSessionRecord(response.session);
    }
    if (typeof fetchSessionsList === "function") {
      await fetchSessionsList();
    }
    if (response?.session && typeof attachSession === "function") {
      collapseTaskMapAfterAction({ render: false });
      attachSession(response.session.id, response.session);
    }
    renderTracker();
    renderPathPanel();
    return response?.session || null;
  }

  async function enterBranchFromCurrentSession(branchTitle, options = {}) {
    const session = getCurrentSessionSafe();
    if (!session?.id || !branchTitle) return null;
    return enterBranchFromSession(session.id, branchTitle, options);
  }

  async function openManualBranchFromText(text, options = {}) {
    const state = deriveQuestState();
    if (!state.hasSession) return null;
    const branchTitle = normalizeTitle(options.branchTitle || deriveBranchTitleFromText(text));
    if (!branchTitle) return null;
    return enterBranchFromCurrentSession(branchTitle, {
      branchReason: options.branchReason || (state.isBranch ? "从当前支线继续拆出子任务" : "从当前对话另开一条支线"),
      checkpointSummary: options.checkpointSummary || state.nextStep || "",
    });
  }

  function canOpenManualBranch() {
    const state = deriveQuestState();
    return Boolean(state.hasSession);
  }

  function createBranchSuggestionItem(evt) {
    const session = getCurrentSessionSafe();
    if (!session?.id || !evt?.branchTitle || isSuppressed(session.id, evt.branchTitle)) {
      return null;
    }
    const isAutoSuggested = evt?.autoSuggested !== false;
    const intentShift = evt?.intentShift === true;
    const independentGoal = evt?.independentGoal === true;
    if (isAutoSuggested && (!intentShift || !independentGoal)) {
      return null;
    }

    const row = document.createElement("div");
    row.className = "quest-branch-suggestion-item";
    if (isAutoSuggested) {
      row.classList.add("quest-branch-suggestion-item-auto");
    }

    const main = document.createElement("div");
    main.className = "quest-branch-suggestion-main";

    const title = document.createElement("div");
    title.className = "quest-branch-suggestion-title";
    title.textContent = evt.branchTitle;
    main.appendChild(title);

    if (evt.branchReason) {
      const summary = document.createElement("div");
      summary.className = "quest-branch-suggestion-summary";
      summary.textContent = evt.branchReason;
      main.appendChild(summary);
    }

    const actions = document.createElement("div");
    actions.className = "quest-branch-suggestion-actions";

    const enterBtn = document.createElement("button");
    enterBtn.type = "button";
    enterBtn.className = "quest-branch-btn quest-branch-btn-primary";
    enterBtn.textContent = "开启支线";
    enterBtn.addEventListener("click", async () => {
      enterBtn.disabled = true;
      try {
        await enterBranchFromCurrentSession(evt.branchTitle, {
          branchReason: evt.branchReason || "",
        });
      } finally {
        enterBtn.disabled = false;
      }
    });

    row.appendChild(main);
    actions.appendChild(enterBtn);
    row.appendChild(actions);
    return row;
  }

  function createMergeNoteCard(evt) {
    if (!evt) return null;
    const card = document.createElement("div");
    card.className = "quest-merge-note";

    const label = document.createElement("div");
    label.className = "quest-merge-note-label";
    label.textContent = evt.mergeType === "conclusion" ? "支线结论已带回主线" : "支线线索已带回主线";
    card.appendChild(label);

    const title = document.createElement("div");
    title.className = "quest-merge-note-title";
    title.textContent = evt.branchTitle || "支线";
    card.appendChild(title);

    const summary = document.createElement("div");
    summary.className = "quest-merge-note-summary";
    summary.textContent = clipText(evt.broughtBack || evt.content || "", 180);
    card.appendChild(summary);

    if (evt.nextStep) {
      const next = document.createElement("div");
      next.className = "quest-merge-note-next";
      next.textContent = `主线下一步：${evt.nextStep}`;
      card.appendChild(next);
    }
    return card;
  }

  function createBranchEnteredCard(evt) {
    if (!evt?.branchTitle) return null;
    const card = document.createElement("div");
    card.className = "quest-merge-note quest-branch-entered-note";

    const label = document.createElement("div");
    label.className = "quest-merge-note-label";
    label.textContent = "已开启支线任务";
    card.appendChild(label);

    const title = document.createElement("div");
    title.className = "quest-merge-note-title";
    title.textContent = evt.branchTitle;
    card.appendChild(title);

    if (evt.branchFrom) {
      const summary = document.createElement("div");
      summary.className = "quest-merge-note-summary";
      summary.textContent = `来自主线：${evt.branchFrom}`;
      card.appendChild(summary);
    }

    return card;
  }

  trackerDetailToggleBtn?.addEventListener("click", () => {
    trackerDetailExpanded = !trackerDetailExpanded;
    renderTracker();
  });

  document.addEventListener("melodysync:session-change", (event) => {
    const nextFocusedSessionId = normalizeSessionId(event?.detail?.session?.id || "");
    collapseTaskMapAfterAction({ render: false });
    if (nextFocusedSessionId) {
      setFocusedSessionId(nextFocusedSessionId, { render: false });
    }
    taskListController?.invalidate?.();
    renderTracker();
    void refreshTrackerSnapshot(nextFocusedSessionId);
    scheduleFullSnapshotRefresh(1400);
  });

  window.addEventListener("focus", () => {
    void refreshTrackerSnapshot();
    scheduleFullSnapshotRefresh(1800);
  });

  window.addEventListener("resize", () => {
    taskListController?.invalidate?.();
    const nextViewportMode = isMobileQuestTracker() ? "mobile" : "desktop";
    if (nextViewportMode !== lastTaskMapViewportMode) {
      lastTaskMapViewportMode = nextViewportMode;
      taskMapExpanded = nextViewportMode === "desktop";
    }
    renderTracker();
  });

  window.addEventListener("melodysync:status-change", () => {
    renderTracker();
  });

  trackerToggleBtn?.addEventListener("click", () => {
    setTaskMapDrawerExpanded(!isTaskMapExpanded());
  });

  taskMapDrawerBtn?.addEventListener("click", () => {
    setTaskMapDrawerExpanded(!isTaskMapExpanded());
  });

  taskMapDrawerBackdrop?.addEventListener("click", () => {
    setTaskMapDrawerExpanded(false);
  });

  taskMapRail?.addEventListener("transitionend", (event) => {
    if (isMobileQuestTracker() || !isTaskMapExpanded()) return;
    const propertyName = String(event?.propertyName || "").trim();
    if (!["width", "transform", "opacity"].includes(propertyName)) return;
    taskListController?.invalidate?.();
    renderTracker();
    if (typeof requestLayoutPass === "function") {
      requestLayoutPass("task-map-settle");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event?.key !== "Escape" || !isMobileTaskMapDrawerOpen()) return;
    setTaskMapDrawerExpanded(false);
  });

  tracker?.addEventListener("mouseenter", () => {
    if (!isMobileQuestTracker()) return;
  });

  tracker?.addEventListener("mouseleave", () => {
    if (!isMobileQuestTracker()) return;
  });

  // ── Operation Record ─────────────────────────────────────────────

  const operationRecordBtn = document.getElementById("operationRecordBtn");
  const operationRecordRail = document.getElementById("operationRecordRail");
  const operationRecordBackdrop = document.getElementById("operationRecordBackdrop");
  const operationRecordCloseBtn = document.getElementById("operationRecordCloseBtn");
  const operationRecordInner = document.getElementById("operationRecordInner");
  branchActionController = window.MelodySyncBranchActions?.createController?.({
    trackerCloseBtn,
    trackerAltBtn,
    trackerBackBtn,
    trackerFooterEl,
    getState: deriveQuestState,
    getSnapshot: () => snapshot,
    setSnapshot: (nextSnapshot) => {
      snapshot = nextSnapshot || snapshot;
    },
    fetchJsonOrRedirect,
    replaceSessionRecord,
    fetchSessionsList: typeof fetchSessionsList === "function" ? fetchSessionsList : null,
    attachSession,
    collapseTaskMapAfterAction,
    renderTracker,
    renderPathPanel,
  }) || {
    syncTrackerButtons() {},
    returnToMainline() {},
    parkAndReturnToMainline() {},
    reopenCurrentBranch() {},
    mergeCurrentBranchSummaryAndReturnToMainline() {},
    setCurrentBranchStatus() {},
  };
  operationRecordController = window.MelodySyncOperationRecordUi?.createController?.({
    operationRecordBtn,
    operationRecordRail,
    operationRecordBackdrop,
    operationRecordCloseBtn,
    operationRecordInner,
    getFocusedSessionId,
    attachSession,
    clipText,
    formatTrackerTime,
  }) || {
    isOpen: () => false,
    setOpen() {},
    render() {},
    handleFocusChange() {},
    refreshIfOpen() {},
  };

  // ─────────────────────────────────────────────────────────────────

  window.MelodySyncWorkbench = {
    surfaceMode: "quest_tracker",
    refresh: refreshSnapshot,
    getSnapshot: () => snapshot,
    getTaskMapProjection,
    getFocusedSessionId,
    setFocusedSessionId,
    canOpenManualBranch,
    createBranchSuggestionItem,
    createBranchEnteredCard,
    createMergeNoteCard,
    enterBranchFromSession,
    enterBranchFromCurrentSession,
    openManualBranchFromText,
    returnToMainline: (...args) => branchActionController.returnToMainline(...args),
    parkAndReturnToMainline: (...args) => branchActionController.parkAndReturnToMainline(...args),
    reopenCurrentBranch: (...args) => branchActionController.reopenCurrentBranch(...args),
    mergeCurrentBranchSummaryAndReturnToMainline: (...args) => branchActionController.mergeCurrentBranchSummaryAndReturnToMainline(...args),
    setCurrentBranchStatus: (...args) => branchActionController.setCurrentBranchStatus(...args),
    openTaskMapDrawer: () => setTaskMapDrawerExpanded(true),
    closeTaskMapDrawer: () => setTaskMapDrawerExpanded(false),
    toggleTaskMapDrawer: () => setTaskMapDrawerExpanded(!isTaskMapExpanded()),
    isTaskMapDrawerOpen: isMobileTaskMapDrawerOpen,
    openOperationRecord: () => operationRecordController.setOpen(true),
    closeOperationRecord: () => operationRecordController.setOpen(false),
    refreshOperationRecord: () => operationRecordController.refreshIfOpen(),
  };

  renderTracker();
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => {
      void refreshTrackerSnapshot();
      scheduleFullSnapshotRefresh(1800);
    }, { timeout: 1200 });
  } else if (typeof window.setTimeout === "function") {
    window.setTimeout(() => {
      void refreshTrackerSnapshot();
      scheduleFullSnapshotRefresh(1800);
    }, 120);
  } else if (typeof setTimeout === "function") {
    setTimeout(() => {
      void refreshTrackerSnapshot();
      scheduleFullSnapshotRefresh(1800);
    }, 120);
  } else {
    void refreshTrackerSnapshot();
    scheduleFullSnapshotRefresh(1800);
  }
})();
