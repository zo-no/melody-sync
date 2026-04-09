(function workbenchModule() {
  const tracker = document.getElementById("questTracker");
  const trackerStatusEl = document.getElementById("questTrackerStatus");
  const trackerStatusDotEl = document.getElementById("questTrackerStatusDot");
  const trackerStatusTextEl = document.getElementById("questTrackerStatusText");
  const headerTitleEl = document.getElementById("headerTitle");
  const headerTaskDetailBtn = document.getElementById("headerTaskDetailBtn");
  const trackerTitleEl = document.getElementById("questTrackerTitle");
  const trackerBranchEl = document.getElementById("questTrackerBranch");
  const trackerBranchLabelEl = document.getElementById("questTrackerBranchLabel");
  const trackerBranchTitleEl = document.getElementById("questTrackerBranchTitle");
  const trackerNextEl = document.getElementById("questTrackerNext");
  const trackerTimeEl = document.getElementById("questTrackerTime");
  const trackerTaskListEl = document.getElementById("questTaskList");
  const taskMapRail = document.getElementById("taskMapRail");
  const sidebarOverlay = document.getElementById("sidebarOverlay");
  const taskMapResizeHandle = document.getElementById("taskMapResizeHandle");
  const taskCanvasPanel = document.getElementById("taskCanvasPanel");
  const taskCanvasTitleEl = document.getElementById("taskCanvasTitle");
  const taskCanvasSummaryEl = document.getElementById("taskCanvasSummary");
  const taskCanvasBodyEl = document.getElementById("taskCanvasBody");
  const taskCanvasExpandBtn = document.getElementById("taskCanvasExpandBtn");
  const taskCanvasCloseBtn = document.getElementById("taskCanvasCloseBtn");
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
  const trackerCandidatesRowEl = document.getElementById("questTrackerCandidatesRow");
  const trackerCandidatesListEl = document.getElementById("questTrackerCandidatesList");
  if (!tracker) return;

  const SUPPRESSED_PREFIX = "melodysyncSuppressedBranch";
  const TASK_MAP_MOCK_STORAGE_KEY = "melodysyncTaskMapMockPreset";
  const TASK_MAP_DESKTOP_WIDTH_STORAGE_KEY = "melodysyncTaskMapDesktopWidth";
  const RECENT_REPARENT_TARGETS_STORAGE_KEY = "melodysyncRecentReparentTargets";
  const TASK_MAP_DESKTOP_MIN_WIDTH = 260;
  const TASK_MAP_DESKTOP_MAX_WIDTH = 960;
  const TASK_MAP_DESKTOP_MAIN_RESERVE = 320;
  const TASK_MAP_DESKTOP_MAX_RATIO = 0.72;

  let snapshot = {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    taskClusters: [],
    taskMapGraph: null,
    skills: [],
    summaries: [],
  };
  let refreshInFlight = null;
  let trackerRefreshInFlight = null;
  let taskMapGraphRefreshInFlight = null;
  let taskMapGraphRefreshSessionId = "";
  let fullSnapshotRefreshTimer = null;
  let trackerExpanded = !isMobileQuestTracker();
  let lastTrackerViewportMode = isMobileQuestTracker() ? "mobile" : "desktop";
  let taskMapExpanded = !isMobileQuestTracker();
  let lastTaskMapViewportMode = isMobileQuestTracker() ? "mobile" : "desktop";
  let questHasSessionTracked = false;
  let focusedSessionId = "";
  let branchActionController = null;
  let trackerDetailExpanded = false;
  let taskMapFlowRenderer = null;
  let taskMapRailRenderKey = "";
  let taskMapRailBoard = null;
  let taskCanvasController = null;
  let questStateSelector = null;
  let trackerRenderer = null;
  let operationRecordController = null;
  let trackerPersistentActionsEl = null;
  let selectedTaskCanvasNodeId = "";
  let mobileTaskDetailExpanded = false;
  let taskMapResizeState = null;
  const workbenchViewModelListeners = new Set();

  function getWorkbenchViewModelState() {
    const questState = deriveQuestState();
    return {
      surfaceMode: "quest_tracker",
      hasSession: Boolean(questState?.hasSession),
      currentSessionId: getCurrentSessionIdSafe(),
      focusedSessionId: getFocusedSessionId(),
      trackerExpanded: trackerExpanded === true,
      taskMapExpanded: isTaskMapExpanded(),
      mobileTaskMapDrawerOpen: isMobileTaskMapDrawerOpen(),
      taskMapRendererKind: String(
        taskMapFlowRenderer?.getRendererKind?.()
        || taskMapFlowRenderer?.rendererKind
        || "unknown",
      ),
      selectedTaskCanvasNodeId: normalizeTaskMapNodeId(selectedTaskCanvasNodeId),
      questState,
      snapshot,
    };
  }

  function notifyWorkbenchViewModel(reason = "update") {
    const nextState = getWorkbenchViewModelState();
    for (const listener of workbenchViewModelListeners) {
      try {
        listener(nextState, reason);
      } catch {}
    }
    if (typeof globalThis?.MelodySyncRuntime?.notify === "function") {
      globalThis.MelodySyncRuntime.notify(`workbench:${reason}`);
    }
    return nextState;
  }

  function subscribeWorkbenchViewModel(listener, { immediate = true } = {}) {
    if (typeof listener !== "function") return () => {};
    workbenchViewModelListeners.add(listener);
    if (immediate) {
      try {
        listener(getWorkbenchViewModelState(), "subscribe");
      } catch {}
    }
    return () => {
      workbenchViewModelListeners.delete(listener);
    };
  }

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

  const COMPLETED_BRANCH_STATUSES = new Set([
    "resolved",
    "merged",
    "done",
    "closed",
    "complete",
    "completed",
    "finished",
  ]);

  const COMPLETED_WORKFLOW_STATES = new Set(["done"]);

  function normalizeStatusToken(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
  }

  function isTrackerTaskCompleted(state) {
    if (!state?.hasSession || !state?.session) return false;
    const normalizedBranchStatus = normalizeStatusToken(state.branchStatus || "");
    if (normalizedBranchStatus && COMPLETED_BRANCH_STATUSES.has(normalizedBranchStatus)) {
      return true;
    }
    const sessionStateModel = window?.MelodySyncSessionStateModel || null;
    const normalizedWorkflowState = typeof sessionStateModel?.normalizeSessionWorkflowState === "function"
      ? sessionStateModel.normalizeSessionWorkflowState(state.session.workflowState || "")
      : normalizeStatusToken(state.session.workflowState || "");
    return COMPLETED_WORKFLOW_STATES.has(normalizedWorkflowState);
  }

  function normalizeComparableText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/[：:·•，。,.;；、!?！？]/g, "")
      .trim()
      .toLowerCase();
  }

  function readRecentReparentTargetIds() {
    try {
      const raw = String(localStorage.getItem(RECENT_REPARENT_TARGETS_STORAGE_KEY) || "").trim();
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((entry) => normalizeSessionId(entry))
        .filter(Boolean)
        .slice(0, 6);
    } catch {
      return [];
    }
  }

  function writeRecentReparentTargetIds(targetSessionIds = []) {
    try {
      const normalized = Array.isArray(targetSessionIds)
        ? targetSessionIds.map((entry) => normalizeSessionId(entry)).filter(Boolean).slice(0, 6)
        : [];
      if (!normalized.length) {
        localStorage.removeItem(RECENT_REPARENT_TARGETS_STORAGE_KEY);
        return;
      }
      localStorage.setItem(RECENT_REPARENT_TARGETS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
    }
  }

  function rememberRecentReparentTarget(targetSessionId) {
    const normalizedTargetSessionId = normalizeSessionId(targetSessionId);
    if (!normalizedTargetSessionId) return;
    const deduped = [
      normalizedTargetSessionId,
      ...readRecentReparentTargetIds().filter((entry) => entry !== normalizedTargetSessionId),
    ];
    writeRecentReparentTargetIds(deduped);
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

  function getTaskMapDesktopWidthLimits() {
    const viewportWidth = Number(window?.innerWidth || 0);
    const sidebarCollapsed = document.body?.classList?.contains?.("sidebar-is-collapsed") === true;
    const sidebarRectWidth = Number(sidebarOverlay?.getBoundingClientRect?.().width || 0);
    const cssSidebarWidth = Number.parseFloat(
      String(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width") || "").trim(),
    );
    const sidebarWidth = sidebarCollapsed
      ? 0
      : (
        (Number.isFinite(sidebarRectWidth) && sidebarRectWidth > 0)
          ? sidebarRectWidth
          : (Number.isFinite(cssSidebarWidth) ? cssSidebarWidth : 288)
      );
    const computedMaxByMainReserve = viewportWidth > 0
      ? (viewportWidth - sidebarWidth - TASK_MAP_DESKTOP_MAIN_RESERVE)
      : TASK_MAP_DESKTOP_MAX_WIDTH;
    const computedMaxByRatio = viewportWidth > 0
      ? Math.floor(viewportWidth * TASK_MAP_DESKTOP_MAX_RATIO)
      : TASK_MAP_DESKTOP_MAX_WIDTH;
    const max = Math.min(
      TASK_MAP_DESKTOP_MAX_WIDTH,
      Math.max(
        TASK_MAP_DESKTOP_MIN_WIDTH,
        Math.min(computedMaxByMainReserve, computedMaxByRatio),
      ),
    );
    return {
      min: TASK_MAP_DESKTOP_MIN_WIDTH,
      max,
    };
  }

  function clampTaskMapDesktopWidth(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const limits = getTaskMapDesktopWidthLimits();
    if (limits.max <= limits.min) return limits.min;
    return Math.min(Math.max(Math.round(numeric), limits.min), limits.max);
  }

  function applyTaskMapDesktopWidth(width, { persist = true } = {}) {
    const clampedWidth = clampTaskMapDesktopWidth(width);
    if (!Number.isFinite(clampedWidth)) return null;
    document.documentElement?.style?.setProperty?.("--task-map-width", `${clampedWidth}px`);
    if (persist) {
      try {
        localStorage.setItem(TASK_MAP_DESKTOP_WIDTH_STORAGE_KEY, String(clampedWidth));
      } catch {
      }
    }
    return clampedWidth;
  }

  function restoreTaskMapDesktopWidthPreference() {
    let storedWidth = "";
    try {
      storedWidth = String(localStorage.getItem(TASK_MAP_DESKTOP_WIDTH_STORAGE_KEY) || "").trim();
    } catch {
      storedWidth = "";
    }
    if (!storedWidth) return;
    applyTaskMapDesktopWidth(Number(storedWidth), { persist: false });
  }

  function reconcileTaskMapDesktopWidthPreference() {
    let storedWidth = "";
    try {
      storedWidth = String(localStorage.getItem(TASK_MAP_DESKTOP_WIDTH_STORAGE_KEY) || "").trim();
    } catch {
      storedWidth = "";
    }
    if (!storedWidth) return;
    applyTaskMapDesktopWidth(Number(storedWidth), { persist: true });
  }

  function resetTaskMapDesktopWidthPreference() {
    try {
      localStorage.removeItem(TASK_MAP_DESKTOP_WIDTH_STORAGE_KEY);
    } catch {
    }
    document.documentElement?.style?.removeProperty?.("--task-map-width");
    invalidateTaskMapRail();
    renderTracker();
    if (typeof requestLayoutPass === "function") {
      requestLayoutPass("task-map-resize-reset");
    }
  }

  function endTaskMapResize({ render = true } = {}) {
    const wasResizing = Boolean(taskMapResizeState);
    taskMapResizeState = null;
    taskMapResizeHandle?.classList?.remove?.("is-dragging");
    document.body?.classList?.remove?.("is-task-map-resizing");
    if (!wasResizing || !render) return;
    invalidateTaskMapRail();
    renderTracker();
    if (typeof requestLayoutPass === "function") {
      requestLayoutPass("task-map-resize-end");
    }
  }

  function beginTaskMapResize(event) {
    if (isMobileQuestTracker() || !isTaskMapExpanded()) return;
    if (!taskMapRail) return;
    const railRect = taskMapRail.getBoundingClientRect();
    const startWidth = Number(railRect?.width || 0);
    if (!Number.isFinite(startWidth) || startWidth <= 0) return;
    taskMapResizeState = {
      pointerId: event.pointerId,
      startX: Number(event.clientX || 0),
      startWidth,
    };
    taskMapResizeHandle?.classList?.add?.("is-dragging");
    document.body?.classList?.add?.("is-task-map-resizing");
  }

  function continueTaskMapResize(event) {
    if (!taskMapResizeState) return;
    if (event.pointerId !== taskMapResizeState.pointerId) return;
    const deltaX = taskMapResizeState.startX - Number(event.clientX || 0);
    const nextWidth = taskMapResizeState.startWidth + deltaX;
    const appliedWidth = applyTaskMapDesktopWidth(nextWidth, { persist: true });
    if (!Number.isFinite(appliedWidth)) return;
    if (typeof requestLayoutPass === "function") {
      requestLayoutPass("task-map-resize-drag");
    }
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
    if (!nextExpanded) {
      endTaskMapResize({ render: false });
    }
    if (typeof requestLayoutPass === "function") {
      requestLayoutPass("task-map-toggle");
    }
    if (options.render !== false) {
      renderTracker();
    }
    notifyWorkbenchViewModel("task-map-drawer");
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
    if (taskMapResizeHandle) {
      const showDesktopHandle = shouldMount && !mobileDrawer && mapExpanded;
      taskMapResizeHandle.hidden = !showDesktopHandle;
      taskMapResizeHandle.setAttribute("aria-hidden", showDesktopHandle ? "false" : "true");
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
    trackerCandidateBranchesRowEl: trackerCandidatesRowEl,
    trackerCandidateBranchesListEl: trackerCandidatesListEl,
    getPersistentActionsEl: ensureTrackerPersistentActionsEl,
    getCurrentSessionSafe,
    isSuppressed,
    enterBranchFromCurrentSession,
    clipText,
    toConciseGoal,
    isMobileQuestTracker,
    isRedundantTrackerText,
    getCurrentTaskSummary: (state) => questStateSelector?.getCurrentTaskSummary?.(state) || "",
    getBranchDisplayName,
  }) || {
    renderStatus() {},
    getPrimaryTitle() { return "当前任务"; },
    getPrimaryDetail() { return ""; },
    getSecondaryDetail() { return ""; },
    renderDetail() {},
    renderPersistentActions() {},
  };
  taskCanvasController = window.MelodySyncWorkbenchNodeCanvasUi?.createController?.({
    railContainerEl: taskMapRail,
    railEl: taskCanvasPanel,
    headerEl: taskCanvasPanel?.querySelector?.(".task-canvas-panel-header") || null,
    titleEl: taskCanvasTitleEl,
    summaryEl: taskCanvasSummaryEl,
    bodyEl: taskCanvasBodyEl,
    expandBtn: taskCanvasExpandBtn,
    closeBtn: taskCanvasCloseBtn,
    onClose: () => clearTaskCanvasNode({ render: true }),
  }) || {
    renderNode() { return false; },
    clear() {},
    isOpen() { return false; },
    isExpanded() { return false; },
    hasCanvasView: hasTaskCanvasView,
  };
  taskMapFlowRenderer = window.MelodySyncTaskMapUi?.createRenderer?.({
    isMobileQuestTracker,
    clipText,
    translate,
    collapseTaskMapAfterAction,
    enterBranchFromSession,
    reparentSession: reparentSessionUnderTarget,
    listReparentTargets: ({ sourceSessionId }) => listReparentTargets(sourceSessionId),
    getSessionRecord,
    attachSession,
    buildTaskHandoffPreview,
    handoffSessionTaskData,
    selectTaskCanvasNode,
    getSelectedTaskCanvasNodeId: () => selectedTaskCanvasNodeId,
    getCurrentSessionId: getCurrentSessionIdSafe,
  }) || {
    renderFlowBoard() {
      const empty = document.createElement("div");
      empty.className = "task-map-empty";
      empty.textContent = "暂无任务地图。";
      return empty;
    },
  };
  function destroyTaskMapRailBoard() {
    const cleanup = taskMapRailBoard?.__melodysyncCleanup;
    if (typeof cleanup === "function") {
      cleanup();
    }
    taskMapRailBoard = null;
  }

  function renderTaskMapRailBoard(board = null) {
    destroyTaskMapRailBoard();
    taskMapRailBoard = board;
    if (!trackerTaskListEl) return;
    trackerTaskListEl.innerHTML = "";
    if (board) {
      trackerTaskListEl.appendChild(board);
    }
  }

  function clearTaskMapRailHost() {
    destroyTaskMapRailBoard();
    if (trackerTaskListEl) {
      trackerTaskListEl.innerHTML = "";
    }
  }

  function invalidateTaskMapRail() {
    taskMapRailRenderKey = "";
  }

  function renderTaskMapRail(state) {
    if (!trackerTaskListEl) return;
    const activeQuest = state?.taskMapProjection?.activeMainQuest || getTaskMapProjection()?.activeMainQuest || null;
    if (!activeQuest) {
      clearTaskMapRailHost();
      trackerTaskListEl.hidden = true;
      invalidateTaskMapRail();
      return;
    }

    const nodeMap = new Map(
      (Array.isArray(activeQuest?.nodes) ? activeQuest.nodes : [])
        .filter((node) => node?.id)
        .map((node) => [node.id, node]),
    );
    const rootNode = nodeMap.get(`session:${activeQuest?.rootSessionId || ""}`) || null;
    const hasMapNodes = nodeMap.size > 0;
    const desktopTaskMap = !isMobileQuestTracker();
    const shouldMount = Boolean(
      state?.hasSession
      && (desktopTaskMap || hasMapNodes)
    );
    if (taskMapRail) taskMapRail.hidden = !shouldMount;
    trackerTaskListEl.classList.toggle("is-flow-board", shouldMount);
    syncTaskMapDrawerUi(shouldMount);
    if (!shouldMount) {
      clearTaskMapRailHost();
      trackerTaskListEl.hidden = true;
      invalidateTaskMapRail();
      return;
    }
    if (!isMobileQuestTracker() && !isTaskMapExpanded()) {
      clearTaskMapRailHost();
      trackerTaskListEl.hidden = true;
      invalidateTaskMapRail();
      return;
    }

    const nodeEntries = Array.isArray(activeQuest?.nodes)
      ? activeQuest.nodes.map((node) => [
        node?.id || "",
        node?.parentNodeId || "",
        node?.status || "",
        node?.kind || "",
        node?.title || "",
      ].join(":"))
      : [];
    const renderKey = [
      state?.session?.id || "",
      activeQuest?.id || "",
      activeQuest?.currentNodeId || "",
      nodeEntries.join("|"),
      String(taskMapFlowRenderer?.getRenderStateKey?.() || "").trim(),
    ].join("||");
    if (
      !trackerTaskListEl.hidden
      && taskMapRailBoard
      && renderKey === taskMapRailRenderKey
    ) {
      return;
    }
    taskMapRailRenderKey = renderKey;

    if (!rootNode) {
      const emptyState = document.createElement("div");
      emptyState.className = "task-map-empty";
      emptyState.textContent = "暂无任务地图。";
      renderTaskMapRailBoard(emptyState);
      trackerTaskListEl.hidden = false;
      return;
    }

    renderTaskMapRailBoard(taskMapFlowRenderer.renderFlowBoard({
      activeQuest,
      nodeMap,
      rootNode,
      state,
    }));
    trackerTaskListEl.hidden = !taskMapRailBoard;
  }

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

  function getGraphClientApi() {
    return window?.MelodySyncWorkbenchGraphClient || null;
  }

  function getNodeEffectsApi() {
    return window?.MelodySyncWorkbenchNodeEffects || null;
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

  function ensureTrackerPersistentActionsEl() {
    if (trackerPersistentActionsEl) return trackerPersistentActionsEl;
    if (!trackerActionsEl) return null;
    trackerPersistentActionsEl = document.createElement("div");
    trackerPersistentActionsEl.className = "quest-tracker-persistent-actions";
    trackerActionsEl.insertBefore(trackerPersistentActionsEl, trackerActionsEl.firstChild || null);
    return trackerPersistentActionsEl;
  }

  function renderPersistentTrackerActions(session) {
    trackerRenderer?.renderPersistentActions?.(session, {
      onPromote: () => {
        operationRecordController?.openPersistentEditor?.({ mode: "promote" });
      },
      onRun: () => {
        dispatchAction?.({
          action: "persistent_run",
          sessionId: session.id,
          runtime: window.MelodySyncSessionTooling?.getCurrentRuntimeSelectionSnapshot?.() || undefined,
        });
      },
      onToggle: () => {
        dispatchAction?.({
          action: "persistent_patch",
          sessionId: session.id,
          persistent: {
            state: String(session?.persistent?.state || "").trim().toLowerCase() === "paused" ? "active" : "paused",
          },
        });
      },
      onConfigure: () => {
        operationRecordController?.openPersistentEditor?.({ mode: "configure" });
      },
    });
  }

  function normalizeTaskMapNodeId(value) {
    return String(value || "").trim();
  }

  function getNodeView(node) {
    return window?.MelodySyncWorkbenchNodeEffects?.getNodeView?.(node) || node?.view || { type: "flow-node" };
  }

  function hasTaskCanvasView(node) {
    return normalizeTaskMapNodeId(getNodeView(node)?.type).toLowerCase() !== "flow-node";
  }

  function resolveTaskCanvasNode(projection, { allowAutoOpen = false } = {}) {
    const quests = Array.isArray(projection?.mainQuests) ? projection.mainQuests : [];
    const activeQuest = projection?.activeMainQuest || quests[0] || null;
    const allNodes = quests.flatMap((quest) => Array.isArray(quest?.nodes) ? quest.nodes : []);
    if ((!activeQuest || !Array.isArray(activeQuest?.nodes)) && allNodes.length === 0) {
      selectedTaskCanvasNodeId = "";
      return null;
    }
    const candidateNodes = Array.isArray(activeQuest?.nodes) ? activeQuest.nodes : allNodes;
    const nodeMap = new Map(candidateNodes.map((node) => [normalizeTaskMapNodeId(node?.id), node]));
    const selectedNode = nodeMap.get(normalizeTaskMapNodeId(selectedTaskCanvasNodeId)) || null;
    if (selectedNode && hasTaskCanvasView(selectedNode)) {
      return selectedNode;
    }
    if (!allowAutoOpen) {
      selectedTaskCanvasNodeId = "";
      return null;
    }

    const currentRichNode = candidateNodes.find((node) => node?.isCurrent && hasTaskCanvasView(node))
      || candidateNodes.find((node) => node?.isCurrentPath && hasTaskCanvasView(node))
      || candidateNodes.find((node) => hasTaskCanvasView(node))
      || allNodes.find((node) => hasTaskCanvasView(node))
      || null;
    selectedTaskCanvasNodeId = normalizeTaskMapNodeId(currentRichNode?.id || "");
    return currentRichNode;
  }

  function resolveWorkbenchDetailPanels({
    mobileTracker = false,
    activeCanvasNode = null,
  } = {}) {
    const showCanvas = Boolean(activeCanvasNode && hasTaskCanvasView(activeCanvasNode));
    const showHeaderTaskDetailBtn = mobileTracker && !showCanvas;
    return {
      showCanvas,
      showHeaderTaskDetailBtn,
      showTracker: showCanvas ? false : (!mobileTracker || mobileTaskDetailExpanded),
    };
  }

  function selectTaskCanvasNode(nodeId, options = {}) {
    selectedTaskCanvasNodeId = normalizeTaskMapNodeId(nodeId);
    if (options.render !== false) {
      renderTracker();
    }
    notifyWorkbenchViewModel("task-canvas-select");
    return selectedTaskCanvasNodeId;
  }

  function clearTaskCanvasNode(options = {}) {
    selectedTaskCanvasNodeId = "";
    if (options.render !== false) {
      renderTracker();
    }
    notifyWorkbenchViewModel("task-canvas-clear");
  }

  function renderTaskCanvas(projection, options = {}) {
    const activeNode = resolveTaskCanvasNode(projection, options);
    const shouldShowCanvas = Boolean(activeNode && hasTaskCanvasView(activeNode));
    taskMapRail?.classList?.toggle?.("has-node-canvas", shouldShowCanvas);
    if (!taskCanvasController) return;
    if (!shouldShowCanvas) {
      taskCanvasController.clear();
      return null;
    }
    taskCanvasController.renderNode(activeNode);
    return activeNode;
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
      invalidateTaskMapRail();
      renderTracker();
      if (options.renderSessionList === true && typeof renderSessionList === "function") {
        renderSessionList();
      }
    }
    if (focusChanged && operationRecordController?.isOpen?.()) {
      operationRecordController.handleFocusChange();
    }
    notifyWorkbenchViewModel("focused-session");
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
    const graphClient = getGraphClientApi();
    const targetSessionId = graphClient?.resolveTaskMapGraphRootSessionId?.({
      sessionId: getFocusedSessionId() || getCurrentSessionIdSafe(),
      snapshot,
      getSessionRecord,
      getCurrentSession: getCurrentSessionSafe,
    }) || "";
    const canonicalProjection = (
      snapshot?.taskMapGraph
      && typeof snapshot.taskMapGraph === "object"
      && graphClient?.canReuseTaskMapGraph?.(snapshot.taskMapGraph, targetSessionId) === true
      && typeof graphClient?.buildProjectionFromTaskMapGraph === "function"
    )
      ? graphClient.buildProjectionFromTaskMapGraph(snapshot.taskMapGraph, {
        currentSessionId: getCurrentSessionIdSafe(),
        focusedSessionId: getFocusedSessionId(),
        snapshot,
        getSessionRecord,
        getCurrentSession: getCurrentSessionSafe,
      })
      : null;
    let projection = canonicalProjection;
    if (!projection) {
      if (typeof window?.MelodySyncTaskMapModel?.buildTaskMapProjection !== "function") {
        return null;
      }
      projection = window.MelodySyncTaskMapModel.buildTaskMapProjection({
        snapshot,
        sessions: getSessionRecords(),
        currentSessionId: getCurrentSessionIdSafe(),
        focusedSessionId: getFocusedSessionId(),
      });
    }
    if (typeof window?.MelodySyncTaskMapModel?.applyTaskMapMockPreset === "function") {
      return window.MelodySyncTaskMapModel.applyTaskMapMockPreset(projection, getTaskMapMockPreset());
    }
    return projection;
  }

  function getWorkbenchSurfaceProjectionApi() {
    return window?.MelodySyncWorkbenchSurfaceProjection || null;
  }

  async function refreshComposerSuggestionSurface(session = null, { force = false } = {}) {
    const targetSession = session?.id ? session : getCurrentSessionSafe();
    if (!targetSession?.id) return [];
    const surfaceApi = getWorkbenchSurfaceProjectionApi();
    if (typeof surfaceApi?.prefetchSurfaceEntriesForSession !== "function") return [];
    try {
      const entries = await surfaceApi.prefetchSurfaceEntriesForSession({
        session: targetSession,
        surfaceSlot: "composer-suggestions",
        force,
      });
      if (
        typeof window.renderSuggestedQuestions === "function"
        && getCurrentSessionSafe()?.id === targetSession.id
      ) {
        window.renderSuggestedQuestions(getCurrentSessionSafe() || targetSession);
      }
      return Array.isArray(entries) ? entries : [];
    } catch {
      return [];
    }
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

  function buildTaskHandoffPreview(sourceSessionId, targetSessionId, options = {}) {
    const sourceSession = getSessionRecord(sourceSessionId) || null;
    const targetSession = getSessionRecord(targetSessionId) || null;
    const sourceTaskCard = sourceSession?.taskCard && typeof sourceSession.taskCard === "object" ? sourceSession.taskCard : {};
    const sourceTitle = normalizeTitle(options.sourceTitle || getSessionDisplayName(sourceSession) || "源任务");
    const targetTitle = normalizeTitle(options.targetTitle || getSessionDisplayName(targetSession) || "目标任务");
    const pickList = (key, max = 3) => (
      Array.isArray(sourceTaskCard?.[key])
        ? sourceTaskCard[key].map((entry) => clipText(entry, 140)).filter(Boolean).slice(0, max)
        : []
    );
    const background = [...pickList("background", 2), ...pickList("rawMaterials", 2)]
      .filter((entry, index, list) => list.indexOf(entry) === index)
      .slice(0, 4);
    const constraints = pickList("assumptions", 3);
    const conclusions = [
      ...pickList("knownConclusions", 3),
      clipText(sourceTaskCard?.checkpoint || sourceTaskCard?.summary || sourceTaskCard?.goal || sourceSession?.name || "", 140),
    ].filter((entry, index, list) => entry && list.indexOf(entry) === index).slice(0, 4);
    const nextSteps = pickList("nextSteps", 3);
    const sections = [
      { key: "background", label: "背景", items: background },
      { key: "constraints", label: "约束", items: constraints },
      { key: "conclusions", label: "结论", items: conclusions },
      { key: "nextSteps", label: "下一步", items: nextSteps },
    ].filter((section) => section.items.length > 0);

    return {
      sourceSessionId: normalizeSessionId(sourceSessionId),
      targetSessionId: normalizeSessionId(targetSessionId),
      sourceTitle,
      targetTitle,
      summary: `${sourceTitle} -> ${targetTitle}`,
      sections: sections.length > 0
        ? sections
        : [{ key: "conclusions", label: "结论", items: [`来自任务「${sourceTitle}」的阶段数据交接`] }],
    };
  }

  async function handoffSessionTaskData(sourceSessionId, payload = {}) {
    const normalizedSourceSessionId = normalizeSessionId(sourceSessionId);
    const targetSessionId = normalizeSessionId(payload?.targetSessionId);
    if (!normalizedSourceSessionId || !targetSessionId || normalizedSourceSessionId === targetSessionId) {
      return null;
    }
    try {
      const response = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(normalizedSourceSessionId)}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetSessionId,
        }),
      });
      if (response?.session) {
        replaceSessionRecord(response.session);
      }
      if (response?.snapshot) {
        snapshot = response.snapshot;
      }
      await refreshTaskMapGraph(getFocusedSessionId() || getCurrentSessionIdSafe(), { force: true });
      renderTracker();
      renderPathPanel();
      return response;
    } catch (error) {
      console.warn("[quest] Failed to handoff task data:", error?.message || error);
      return null;
    }
  }

  function collectTaskMapSessionEntries() {
    const entriesById = new Map();
    const childrenByParent = new Map();
    for (const cluster of Array.isArray(snapshot?.taskClusters) ? snapshot.taskClusters : []) {
      const rootSessionId = normalizeSessionId(cluster?.mainSessionId || cluster?.mainSession?.id || "");
      const rootSession = cluster?.mainSession || getSessionRecord(rootSessionId) || null;
      if (rootSessionId && rootSession) {
        entriesById.set(rootSessionId, {
          sessionId: rootSessionId,
          session: rootSession,
          parentSessionId: "",
          clusterRootSessionId: rootSessionId,
          depth: 0,
          title: getSessionDisplayName(rootSession),
        });
      }
      for (const branchSession of Array.isArray(cluster?.branchSessions) ? cluster.branchSessions : []) {
        const sessionId = normalizeSessionId(branchSession?.id || "");
        if (!sessionId) continue;
        const parentSessionId = normalizeSessionId(branchSession?._branchParentSessionId || rootSessionId);
        entriesById.set(sessionId, {
          sessionId,
          session: branchSession,
          parentSessionId,
          clusterRootSessionId: rootSessionId || parentSessionId,
          depth: Number.isFinite(branchSession?._branchDepth) ? branchSession._branchDepth : 1,
          title: getBranchDisplayName(branchSession),
        });
        if (parentSessionId) {
          if (!childrenByParent.has(parentSessionId)) {
            childrenByParent.set(parentSessionId, []);
          }
          childrenByParent.get(parentSessionId).push(sessionId);
        }
      }
    }
    for (const session of getSessionRecords()) {
      const sessionId = normalizeSessionId(session?.id || "");
      if (!sessionId || entriesById.has(sessionId)) continue;
      entriesById.set(sessionId, {
        sessionId,
        session,
        parentSessionId: "",
        clusterRootSessionId: sessionId,
        depth: 0,
        title: getSessionDisplayName(session),
      });
    }
    return {
      entriesById,
      childrenByParent,
    };
  }

  function collectSessionSubtreeIds(sourceSessionId, childrenByParent = new Map()) {
    const normalizedSourceSessionId = normalizeSessionId(sourceSessionId);
    const subtreeIds = new Set();
    if (!normalizedSourceSessionId) return subtreeIds;
    const stack = [normalizedSourceSessionId];
    while (stack.length > 0) {
      const currentSessionId = normalizeSessionId(stack.pop());
      if (!currentSessionId || subtreeIds.has(currentSessionId)) continue;
      subtreeIds.add(currentSessionId);
      for (const childSessionId of childrenByParent.get(currentSessionId) || []) {
        stack.push(childSessionId);
      }
    }
    return subtreeIds;
  }

  function buildSessionPathLabel(sessionId, entriesById = new Map()) {
    const segments = [];
    const visited = new Set();
    let cursorId = normalizeSessionId(sessionId);
    while (cursorId && !visited.has(cursorId)) {
      visited.add(cursorId);
      const entry = entriesById.get(cursorId);
      if (!entry) break;
      segments.unshift(entry.title || getSessionDisplayName(entry.session));
      cursorId = normalizeSessionId(entry.parentSessionId);
    }
    if (segments.length <= 1) return "顶层任务";
    return segments.join(" / ");
  }

  function listReparentTargets(sourceSessionId) {
    const normalizedSourceSessionId = normalizeSessionId(sourceSessionId);
    if (!normalizedSourceSessionId) return [];
    const { entriesById, childrenByParent } = collectTaskMapSessionEntries();
    const sourceEntry = entriesById.get(normalizedSourceSessionId) || null;
    const sourceClusterRootSessionId = normalizeSessionId(sourceEntry?.clusterRootSessionId || "");
    const sourceSubtreeIds = collectSessionSubtreeIds(normalizedSourceSessionId, childrenByParent);
    const recentTargetIds = readRecentReparentTargetIds();
    const recentTargetIndex = new Map();
    recentTargetIds.forEach((sessionId, index) => {
      recentTargetIndex.set(sessionId, index);
    });
    const targets = [];

    if (normalizeSessionId(sourceEntry?.parentSessionId || "")) {
      targets.push({
        mode: "detach",
        sessionId: "",
        title: "移出为主线",
        path: "从当前父任务下移出",
        sameCluster: true,
        depth: -1,
        searchText: normalizeComparableText("移出为主线 从当前父任务下移出"),
      });
    }

    for (const entry of entriesById.values()) {
      if (!entry?.sessionId || sourceSubtreeIds.has(entry.sessionId)) continue;
      const path = buildSessionPathLabel(entry.sessionId, entriesById);
      const recentIndex = recentTargetIndex.has(entry.sessionId)
        ? recentTargetIndex.get(entry.sessionId)
        : Number.POSITIVE_INFINITY;
      const isRecent = Number.isFinite(recentIndex);
      targets.push({
        mode: "attach",
        sessionId: entry.sessionId,
        title: entry.title || getSessionDisplayName(entry.session),
        path,
        displayPath: isRecent
          ? `最近使用 · ${path === "顶层任务" ? (entry.title || "顶层任务") : path}`
          : path,
        sameCluster: normalizeSessionId(entry.clusterRootSessionId) === sourceClusterRootSessionId,
        recentIndex,
        depth: Number.isFinite(entry.depth) ? entry.depth : 0,
        searchText: normalizeComparableText(`${entry.title || ""} ${path}`),
      });
    }

    return targets.sort((left, right) => {
      if (left.mode !== right.mode) return left.mode === "detach" ? -1 : 1;
      const leftRecentIndex = Number.isFinite(left.recentIndex) ? left.recentIndex : Number.POSITIVE_INFINITY;
      const rightRecentIndex = Number.isFinite(right.recentIndex) ? right.recentIndex : Number.POSITIVE_INFINITY;
      if (leftRecentIndex !== rightRecentIndex) return leftRecentIndex - rightRecentIndex;
      if (left.sameCluster !== right.sameCluster) return left.sameCluster ? -1 : 1;
      if ((left.depth || 0) !== (right.depth || 0)) return (left.depth || 0) - (right.depth || 0);
      return String(left.title || "").localeCompare(String(right.title || ""), "zh-Hans-CN");
    });
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
      mobileTaskDetailExpanded = false;
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
    const taskMapProjection = getTaskMapProjection();
    const taskMapActiveNode = taskMapProjection?.activeNode || null;
    const taskMapVisualStatus = taskMapActiveNode
      ? (getNodeEffectsApi()?.getNodeTaskRunStatusUi?.(taskMapActiveNode) || null)
      : null;
    const state = {
      ...deriveQuestState(),
      taskMapProjection,
      taskMapActiveNode,
      taskMapVisualStatus,
    };
    // Keep suggested questions in sync with the current session state.
    if (typeof window.renderSuggestedQuestions === "function") {
      window.renderSuggestedQuestions(state.session || null);
    }
    if (!state.hasSession) {
      tracker.hidden = true;
      tracker.classList.remove("is-branch-focus", "is-task-complete");
      headerTaskDetailBtn?.classList?.remove?.("is-task-complete");
      if (taskMapRail) taskMapRail.hidden = true;
      if (trackerTaskListEl) trackerTaskListEl.hidden = true;
      if (headerTaskDetailBtn) headerTaskDetailBtn.hidden = true;
      if (headerTitleEl) headerTitleEl.hidden = false;
      taskMapRail?.classList?.remove?.("has-node-canvas");
      taskCanvasController?.clear?.();
      syncTaskMapDrawerUi(false);
      syncQuestEmptyState(state);
      notifyWorkbenchViewModel("render");
      return;
    }

    tracker.hidden = false;
    scrollWorkbenchToTopIfNeeded(state);
    syncQuestEmptyState(state);
    const showBranch = Boolean(state.isBranch && state.currentGoal);
    const taskCompleted = isTrackerTaskCompleted(state);
    tracker.classList.toggle("is-branch-focus", showBranch);
    tracker.classList.toggle("is-task-complete", taskCompleted);
    const branchStatus = String(state.branchStatus || "").toLowerCase();
    renderTrackerStatus(state);
    const trackerTitle = getTrackerPrimaryTitle(state);
    const trackerPrimaryDetail = getTrackerPrimaryDetail(state);
    const trackerSecondaryDetail = getTrackerSecondaryDetail(state, trackerPrimaryDetail);
    const mobileTracker = isMobileQuestTracker();
    const activeCanvasNode = renderTaskCanvas(taskMapProjection, { allowAutoOpen: true });
    const detailPanels = resolveWorkbenchDetailPanels({
      mobileTracker,
      activeCanvasNode,
    });
    const expanded = detailPanels.showTracker;
    if (headerTaskDetailBtn) {
      headerTaskDetailBtn.hidden = !detailPanels.showHeaderTaskDetailBtn;
      headerTaskDetailBtn.classList.toggle("is-task-complete", taskCompleted);
      const headerTaskLabel = clipText(trackerTitle, 28) || "当前任务";
      headerTaskDetailBtn.textContent = `${headerTaskLabel} ${expanded ? "▾" : "▸"}`;
      headerTaskDetailBtn.title = trackerTitle || headerTaskLabel;
      headerTaskDetailBtn.setAttribute("aria-label", `${expanded ? "收起" : "展开"}任务详情：${trackerTitle || headerTaskLabel}`);
      headerTaskDetailBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
    }
    if (headerTitleEl) {
      headerTitleEl.hidden = detailPanels.showHeaderTaskDetailBtn;
    }
    tracker.hidden = !expanded;
    trackerTitleEl.textContent = trackerTitle;
    trackerTitleEl.hidden = false;
    const sessionTime = state.session?.lastEventAt || state.session?.updatedAt || state.session?.created || "";
    const timeText = formatTrackerTime(sessionTime);
    if (trackerBranchEl) {
      trackerBranchEl.hidden = !trackerPrimaryDetail;
      trackerBranchLabelEl.textContent = showBranch ? "主线任务" : "当前推进";
      trackerBranchTitleEl.textContent = trackerPrimaryDetail;
    }
    trackerNextEl.hidden = !trackerSecondaryDetail;
    trackerNextEl.textContent = trackerSecondaryDetail;
    if (trackerTimeEl) {
      trackerTimeEl.hidden = !timeText;
      trackerTimeEl.textContent = timeText;
    }
    if (trackerToggleBtn) {
      trackerToggleBtn.hidden = true;
    }
    trackerActionsEl?.classList.toggle("is-inline-links", Boolean(
      showBranch && (branchStatus === "active" || ["resolved", "merged", "parked"].includes(branchStatus))
    ));
    renderPersistentTrackerActions(state.session);
    branchActionController?.syncTrackerButtons(state);
    renderTaskMapRail(state);
    renderTrackerDetail(state.session);
    notifyWorkbenchViewModel("render");
  }

  function renderTrackerDetail(session) {
    trackerRenderer?.renderDetail(session?.taskCard, trackerDetailExpanded, session);
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
    if (Array.isArray(patch.taskMapPlans)) {
      snapshot.taskMapPlans = patch.taskMapPlans;
    }
    if (patch.taskMapGraph && typeof patch.taskMapGraph === "object") {
      snapshot.taskMapGraph = patch.taskMapGraph;
    }
  }

  async function refreshTaskMapGraph(sessionIdOverride = "", { force = false } = {}) {
    const graphClient = getGraphClientApi();
    const targetSessionId = graphClient?.resolveTaskMapGraphRootSessionId?.({
      sessionId: sessionIdOverride || getFocusedSessionId() || getCurrentSessionIdSafe(),
      snapshot,
      getSessionRecord,
      getCurrentSession: getCurrentSessionSafe,
    }) || "";
    if (!targetSessionId || typeof graphClient?.fetchTaskMapGraphForSession !== "function") return null;
    if (
      !force
      && snapshot?.taskMapGraph
      && graphClient?.canReuseTaskMapGraph?.(snapshot.taskMapGraph, targetSessionId) === true
    ) {
      return snapshot.taskMapGraph;
    }
    if (
      taskMapGraphRefreshInFlight
      && normalizeSessionId(taskMapGraphRefreshSessionId) === targetSessionId
    ) {
      return taskMapGraphRefreshInFlight;
    }
    taskMapGraphRefreshSessionId = targetSessionId;
    taskMapGraphRefreshInFlight = (async () => {
      try {
        const response = await graphClient.fetchTaskMapGraphForSession(targetSessionId);
        if (response?.taskMapGraph && typeof response.taskMapGraph === "object") {
          snapshot.taskMapGraph = response.taskMapGraph;
        }
      } catch {
      } finally {
        taskMapGraphRefreshInFlight = null;
      }
      return snapshot.taskMapGraph || null;
    })();
    return taskMapGraphRefreshInFlight;
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
      await refreshTaskMapGraph(targetSessionId, { force: true });
      renderTracker();
      renderPathPanel();
      void refreshComposerSuggestionSurface(getSessionRecord(targetSessionId) || getCurrentSessionSafe(), { force: true });
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
          taskMapGraph: null,
          skills: [],
          summaries: [],
        };
      }
      await refreshTaskMapGraph(getFocusedSessionId() || getCurrentSessionIdSafe(), { force: false });
      renderTracker();
      renderPathPanel();
      void refreshComposerSuggestionSurface(getCurrentSessionSafe(), { force: true });
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

  async function reparentSessionUnderTarget(sessionId, options = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) return null;
    const normalizedTargetSessionId = normalizeSessionId(options?.targetSessionId || "");
    const response = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(normalizedSessionId)}/reparent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetSessionId: normalizedTargetSessionId,
        branchReason: String(options?.branchReason || "").trim(),
      }),
    });
    snapshot = response?.snapshot || snapshot;
    if (response?.session) {
      replaceSessionRecord(response.session);
    }
    if (normalizedTargetSessionId) {
      rememberRecentReparentTarget(normalizedTargetSessionId);
    }
    if (typeof fetchSessionsList === "function") {
      await fetchSessionsList();
    }
    await refreshTrackerSnapshot(normalizedSessionId);
    return response?.session || null;
  }

  function createBranchSuggestionItem(evt) {
    const statusCardRendererFactory = globalThis?.MelodySyncWorkbenchStatusCardUi?.createRenderer
      || globalThis?.window?.MelodySyncWorkbenchStatusCardUi?.createRenderer
      || null;
    if (typeof statusCardRendererFactory !== "function") return null;
    const renderer = createBranchSuggestionItem.__melodysyncReactRenderer
      || statusCardRendererFactory({
        documentRef: document,
        windowRef: window,
        getCurrentSessionSafe,
        isSuppressed,
        enterBranchFromCurrentSession,
        clipText: typeof clipText === "function" ? clipText : undefined,
      });
    if (!renderer) return null;
    createBranchSuggestionItem.__melodysyncReactRenderer = renderer;
    return renderer.createBranchSuggestionItem?.(evt) || null;
  }

  function createMergeNoteCard(evt) {
    const statusCardRendererFactory = globalThis?.MelodySyncWorkbenchStatusCardUi?.createRenderer
      || globalThis?.window?.MelodySyncWorkbenchStatusCardUi?.createRenderer
      || null;
    if (typeof statusCardRendererFactory !== "function") return null;
    const renderer = createMergeNoteCard.__melodysyncReactRenderer
      || statusCardRendererFactory({
        documentRef: document,
        windowRef: window,
        getCurrentSessionSafe,
        isSuppressed,
        enterBranchFromCurrentSession,
        clipText: typeof clipText === "function" ? clipText : undefined,
      });
    if (!renderer) return null;
    createMergeNoteCard.__melodysyncReactRenderer = renderer;
    return renderer.createMergeNoteCard?.(evt) || null;
  }

  function createBranchEnteredCard(evt) {
    const statusCardRendererFactory = globalThis?.MelodySyncWorkbenchStatusCardUi?.createRenderer
      || globalThis?.window?.MelodySyncWorkbenchStatusCardUi?.createRenderer
      || null;
    if (typeof statusCardRendererFactory !== "function") return null;
    const renderer = createBranchEnteredCard.__melodysyncReactRenderer
      || statusCardRendererFactory({
        documentRef: document,
        windowRef: window,
        getCurrentSessionSafe,
        isSuppressed,
        enterBranchFromCurrentSession,
        clipText: typeof clipText === "function" ? clipText : undefined,
      });
    if (!renderer) return null;
    createBranchEnteredCard.__melodysyncReactRenderer = renderer;
    return renderer.createBranchEnteredCard?.(evt) || null;
  }

  trackerDetailToggleBtn?.addEventListener("click", () => {
    trackerDetailExpanded = !trackerDetailExpanded;
    renderTracker();
  });

  headerTaskDetailBtn?.addEventListener("click", () => {
    mobileTaskDetailExpanded = !mobileTaskDetailExpanded;
    clearTaskCanvasNode({ render: false });
    renderTracker();
  });

  document.addEventListener("melodysync:session-change", (event) => {
    const nextFocusedSessionId = normalizeSessionId(event?.detail?.session?.id || "");
    collapseTaskMapAfterAction({ render: false });
    mobileTaskDetailExpanded = false;
    selectedTaskCanvasNodeId = "";
    snapshot.taskMapGraph = null;
    if (nextFocusedSessionId) {
      setFocusedSessionId(nextFocusedSessionId, { render: false });
    }
    getWorkbenchSurfaceProjectionApi()?.invalidateSurfaceEntriesForSession?.({
      session: event?.detail?.session || getCurrentSessionSafe(),
      surfaceSlot: "composer-suggestions",
    });
    invalidateTaskMapRail();
    renderTracker();
    void refreshTrackerSnapshot(nextFocusedSessionId);
    scheduleFullSnapshotRefresh(1400);
  });

  window.addEventListener("focus", () => {
    void refreshTrackerSnapshot();
    scheduleFullSnapshotRefresh(1800);
  });

  window.addEventListener("resize", () => {
    invalidateTaskMapRail();
    const nextViewportMode = isMobileQuestTracker() ? "mobile" : "desktop";
    if (nextViewportMode !== lastTrackerViewportMode) {
      lastTrackerViewportMode = nextViewportMode;
      trackerExpanded = nextViewportMode === "desktop";
    }
    if (nextViewportMode !== lastTaskMapViewportMode) {
      lastTaskMapViewportMode = nextViewportMode;
      taskMapExpanded = nextViewportMode === "desktop";
    }
    if (nextViewportMode === "mobile") {
      endTaskMapResize({ render: false });
    } else {
      reconcileTaskMapDesktopWidthPreference();
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

  taskMapResizeHandle?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    beginTaskMapResize(event);
    try {
      taskMapResizeHandle.setPointerCapture(event.pointerId);
    } catch {
    }
  });

  taskMapResizeHandle?.addEventListener("pointermove", (event) => {
    continueTaskMapResize(event);
  });

  taskMapResizeHandle?.addEventListener("pointerup", (event) => {
    if (!taskMapResizeState || event.pointerId !== taskMapResizeState.pointerId) return;
    endTaskMapResize();
  });

  taskMapResizeHandle?.addEventListener("pointercancel", () => {
    endTaskMapResize();
  });

  taskMapResizeHandle?.addEventListener("dblclick", () => {
    if (isMobileQuestTracker()) return;
    resetTaskMapDesktopWidthPreference();
  });

  taskMapRail?.addEventListener("transitionend", (event) => {
    if (isMobileQuestTracker() || !isTaskMapExpanded()) return;
    const propertyName = String(event?.propertyName || "").trim();
    if (!["width", "transform", "opacity"].includes(propertyName)) return;
    invalidateTaskMapRail();
    renderTracker();
    if (typeof requestLayoutPass === "function") {
      requestLayoutPass("task-map-settle");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event?.key !== "Escape" || !isMobileTaskMapDrawerOpen()) return;
    setTaskMapDrawerExpanded(false);
  });

  window.addEventListener("blur", () => {
    endTaskMapResize();
  });

  tracker?.addEventListener("mouseenter", () => {
    if (!isMobileQuestTracker()) return;
  });

  tracker?.addEventListener("mouseleave", () => {
    if (!isMobileQuestTracker()) return;
  });

  // ── Operation Record ─────────────────────────────────────────────

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
    getFocusedSessionId,
    getFocusedSessionRecord,
    attachSession,
    dispatchAction: typeof dispatchAction === "function" ? dispatchAction : null,
    clipText,
    formatTrackerTime,
  }) || {
    isOpen: () => false,
    setOpen() {},
    render() {},
    handleFocusChange() {},
    refreshIfOpen() {},
    openPersistentEditor() {},
  };

  // ─────────────────────────────────────────────────────────────────

  restoreTaskMapDesktopWidthPreference();

  window.MelodySyncWorkbench = {
    surfaceMode: "quest_tracker",
    refresh: refreshSnapshot,
    getState: getWorkbenchViewModelState,
    subscribe: subscribeWorkbenchViewModel,
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
    getTaskMapRendererKind: () => String(taskMapFlowRenderer?.getRendererKind?.() || taskMapFlowRenderer?.rendererKind || "unknown"),
    selectTaskCanvasNode,
    clearTaskCanvasNode,
    refreshOperationRecord: () => operationRecordController.refreshIfOpen(),
  };
  window.MelodySyncWorkbenchViewModel = Object.freeze({
    getState: getWorkbenchViewModelState,
    subscribe: subscribeWorkbenchViewModel,
  });

  renderTracker();
  void refreshComposerSuggestionSurface(getCurrentSessionSafe(), { force: true });
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
