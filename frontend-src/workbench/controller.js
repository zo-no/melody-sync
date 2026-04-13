/**
 * Workbench coordinator — wires the task tracker, task map, and task canvas panels.
 *
 * WHAT THIS FILE OWNS:
 *   - Tracker panel: renders session state, branch candidates, persistent task summary
 *   - Task map rail: renders the graph board (delegated to MelodySyncTaskMapFlowRenderer)
 *   - Task canvas: renders node detail panel when a graph node is selected
 *   - Resize/layout: desktop task map resize handle, mobile drawer
 *   - Refresh scheduling: debounced snapshot refresh, tracker refresh, task map graph refresh
 *
 * STATE (module-level, all private to this IIFE):
 *   snapshot        — latest workbench snapshot from /api/workbench
 *   focusedSessionId — which session the tracker is pinned to (empty = follow active session)
 *   taskMapRailBoard — current React root for the task map (destroyed/recreated on session change)
 *   taskCanvasController — current task canvas instance
 *
 * KEY INVARIANT:
 *   renderTaskMapRailBoard() guards against re-rendering the same board object —
 *   always check `if (board && taskMapRailBoard === board) return` before destroying.
 *   Skipping this causes React root flicker on node clicks.
 *
 * EXTERNAL DEPENDENCIES (globals injected by other modules):
 *   window.MelodySyncTaskMapFlowRenderer, window.MelodySyncBranchActions,
 *   window.MelodySyncTaskCanvas, window.MelodySyncGraphClient
 *
 * TO ADD A NEW TRACKER SECTION: add a renderXxx() call inside renderTracker().
 * TO ADD A NEW TASK MAP SURFACE: update the graph client and add a case in renderTaskMapRail().
 */
(function workbenchModule() {
  const tracker = document.getElementById("questTracker");
  const trackerStatusEl = document.getElementById("questTrackerStatus");
  const trackerStatusDotEl = document.getElementById("questTrackerStatusDot");
  const trackerStatusTextEl = document.getElementById("questTrackerStatusText");
  const headerTitleEl = document.getElementById("headerTitle");
  const headerTaskDetailBtn = document.getElementById("headerTaskDetailBtn");
  const trackerTitleEl = document.getElementById("questTrackerTitle");
  const trackerProjectRowEl = document.getElementById("questTrackerProjectRow");
  const trackerProjectBtnEl = document.getElementById("questTrackerProjectBtn");
  const trackerProjectNameEl = document.getElementById("questTrackerProjectName");
  const trackerBranchEl = document.getElementById("questTrackerBranch");
  const trackerBranchLabelEl = document.getElementById("questTrackerBranchLabel");
  const trackerBranchTitleEl = document.getElementById("questTrackerBranchTitle");
  const trackerNextEl = document.getElementById("questTrackerNext");
  const trackerTimeEl = document.getElementById("questTrackerTime");
  const trackerPersistentSummaryEl = document.getElementById("questTrackerPersistentSummary");
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
  const taskMapDrawerCloseBtn = document.getElementById("taskMapDrawerCloseBtn");
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
  const trackerMemoryCandidatesRowEl = document.getElementById("questTrackerMemoryCandidatesRow");
  const trackerMemoryCandidatesListEl = document.getElementById("questTrackerMemoryCandidatesList");
  const trackerCandidatesRowEl = document.getElementById("questTrackerCandidatesRow");
  const trackerCandidatesListEl = document.getElementById("questTrackerCandidatesList");
  if (!tracker) return;

  const SUPPRESSED_PREFIX = "melodysyncSuppressedBranch";
  const LONG_TERM_SUGGESTION_SUPPRESSED_PREFIX = "melodysyncSuppressedLongTermSuggestion";
  const TASK_MAP_DESKTOP_WIDTH_STORAGE_KEY = "melodysyncTaskMapDesktopWidth";
  const RECENT_REPARENT_TARGETS_STORAGE_KEY = "melodysyncRecentReparentTargets";
  const RECENT_CONNECT_TARGETS_STORAGE_KEY = "melodysyncRecentConnectTargets";
  const RECENT_HANDOFF_TARGETS_STORAGE_KEY = "melodysyncRecentHandoffTargets";
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
  let trackerDetailExpanded = false; // Detail is collapsed by default; user opens explicitly
  let taskMapFlowRenderer = null;
  let taskMapRailRenderKey = "";
  let taskMapRailBoard = null;
  let taskCanvasController = null;
  let questStateSelector = null;
  let trackerRenderer = null;
  let operationRecordController = null;
  let trackerPersistentActionsEl = null;
  let trackerHandoffActionsEl = null;
  let selectedTaskCanvasNodeId = "";
  let taskCanvasAutoOpenSuppressed = false;
  let mobileTaskDetailExpanded = false;
  let taskMapResizeState = null;
  const liveTaskCardPreviewBySessionId = new Map();
  const lastRunStateBySessionId = new Map();
  const workbenchViewModelListeners = new Set();
  const pendingMemoryCandidatesBySessionId = new Map();
  const memoryCandidateRefreshInFlightBySessionId = new Map();
  const LIVE_TASK_CARD_SCALAR_KEYS = Object.freeze([
    "mode",
    "summary",
    "goal",
    "mainGoal",
    "lineRole",
    "branchFrom",
    "branchReason",
    "checkpoint",
  ]);
  const LIVE_TASK_CARD_ARRAY_KEYS = Object.freeze([
    "candidateBranches",
    "knownConclusions",
  ]);

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

  function readRecentConnectTargetIds() {
    try {
      const raw = String(localStorage.getItem(RECENT_CONNECT_TARGETS_STORAGE_KEY) || "").trim();
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((entry) => normalizeSessionId(entry))
        .filter(Boolean)
        .slice(0, 8);
    } catch {
      return [];
    }
  }

  function writeRecentConnectTargetIds(targetSessionIds = []) {
    try {
      const normalized = Array.isArray(targetSessionIds)
        ? targetSessionIds.map((entry) => normalizeSessionId(entry)).filter(Boolean).slice(0, 8)
        : [];
      if (!normalized.length) {
        localStorage.removeItem(RECENT_CONNECT_TARGETS_STORAGE_KEY);
        return;
      }
      localStorage.setItem(RECENT_CONNECT_TARGETS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
    }
  }

  function rememberRecentConnectTarget(targetSessionId) {
    const normalizedTargetSessionId = normalizeSessionId(targetSessionId);
    if (!normalizedTargetSessionId) return;
    const deduped = [
      normalizedTargetSessionId,
      ...readRecentConnectTargetIds().filter((entry) => entry !== normalizedTargetSessionId),
    ];
    writeRecentConnectTargetIds(deduped);
  }

  function readRecentHandoffTargetIds() {
    try {
      const raw = String(localStorage.getItem(RECENT_HANDOFF_TARGETS_STORAGE_KEY) || "").trim();
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((entry) => normalizeSessionId(entry))
        .filter(Boolean)
        .slice(0, 8);
    } catch {
      return [];
    }
  }

  function writeRecentHandoffTargetIds(targetSessionIds = []) {
    try {
      const normalized = Array.isArray(targetSessionIds)
        ? targetSessionIds.map((entry) => normalizeSessionId(entry)).filter(Boolean).slice(0, 8)
        : [];
      if (!normalized.length) {
        localStorage.removeItem(RECENT_HANDOFF_TARGETS_STORAGE_KEY);
        return;
      }
      localStorage.setItem(RECENT_HANDOFF_TARGETS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
    }
  }

  function rememberRecentHandoffTarget(targetSessionId) {
    const normalizedTargetSessionId = normalizeSessionId(targetSessionId);
    if (!normalizedTargetSessionId) return;
    const deduped = [
      normalizedTargetSessionId,
      ...readRecentHandoffTargetIds().filter((entry) => entry !== normalizedTargetSessionId),
    ];
    writeRecentHandoffTargetIds(deduped);
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
    if (isMobileQuestTracker() && trackerStatusEl) {
      trackerStatusEl.hidden = true;
    }
  }

  function hasVisibleTrackerActions() {
    if (!trackerActionsEl) return false;
    return Array.from(trackerActionsEl.children || []).some((child) => child && child.hidden !== true);
  }

  function syncTrackerFooterVisibility() {
    if (!trackerFooterEl) return;
    const showStatus = Boolean(trackerStatusEl && trackerStatusEl.hidden !== true);
    const showActions = hasVisibleTrackerActions();
    trackerFooterEl.hidden = !showStatus && !showActions;
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
    trackerMemoryCandidateRowEl: trackerMemoryCandidatesRowEl,
    trackerMemoryCandidateListEl: trackerMemoryCandidatesListEl,
    trackerCandidateBranchesRowEl: trackerCandidatesRowEl,
    trackerCandidateBranchesListEl: trackerCandidatesListEl,
    getPersistentActionsEl: ensureTrackerPersistentActionsEl,
    getHandoffActionsEl: ensureTrackerHandoffActionsEl,
    getCurrentSessionSafe,
    getPendingMemoryCandidates,
    reviewMemoryCandidate,
    isSuppressed,
    enterBranchFromCurrentSession,
    clipText,
    toConciseGoal,
    isMobileQuestTracker,
    isRedundantTrackerText,
    getCurrentTaskSummary: (state) => questStateSelector?.getCurrentTaskSummary?.(state) || "",
    getBranchDisplayName,
    listTaskHandoffTargets,
    buildTaskHandoffPreview,
    handoffSessionTaskData,
  }) || {
    renderStatus() {},
    getPrimaryTitle() { return "当前任务"; },
    getPrimaryDetail() { return ""; },
    getSecondaryDetail() { return ""; },
    renderDetail() {},
    renderHandoffActions() {},
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
    if (board && taskMapRailBoard === board) {
      return;
    }
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
    const edgeEntries = Array.isArray(activeQuest?.edges)
      ? activeQuest.edges.map((edge) => [
        edge?.id || "",
        edge?.fromNodeId || edge?.from || "",
        edge?.toNodeId || edge?.to || "",
        edge?.type || edge?.variant || "",
      ].join(":"))
      : [];
    // Include collapsed node state in renderKey so toggling collapse triggers re-render
    const collapsedKey = (() => {
      try {
        const raw = localStorage.getItem('melodysyncCollapsedTaskMapNodes');
        if (!raw) return '';
        const ids = JSON.parse(raw);
        return Array.isArray(ids) ? [...ids].sort().join(',') : '';
      } catch { return ''; }
    })();
    const renderKey = [
      state?.session?.id || "",
      activeQuest?.id || "",
      activeQuest?.currentNodeId || "",
      nodeEntries.join("|"),
      edgeEntries.join("|"),
      String(taskMapFlowRenderer?.getRenderStateKey?.() || "").trim(),
      collapsedKey,
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
      /继续把当前目标再推进一步/i,
      /继续推进这项任务/i,
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
    if (typeof getCurrentSession === "function") {
      return withLiveTaskCardPreview(getCurrentSession());
    }
    return null;
  }

  function normalizeSessionId(value) {
    return String(value || "").trim();
  }

  function normalizeMemoryCandidate(candidate = null) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const id = String(candidate.id || "").trim();
    const text = String(candidate.text || "").trim();
    const sessionId = normalizeSessionId(candidate.sessionId || "");
    const status = String(candidate.status || "").trim().toLowerCase();
    if (!id || !text || !sessionId) return null;
    if (status && status !== "candidate") return null;
    return {
      ...candidate,
      id,
      text,
      sessionId,
      status: "candidate",
      target: String(candidate.target || "").trim(),
      type: String(candidate.type || "").trim(),
      reason: String(candidate.reason || "").trim(),
    };
  }

  function setPendingMemoryCandidatesForSession(sessionId, items = []) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) return [];
    const normalizedItems = (Array.isArray(items) ? items : [])
      .map((entry) => normalizeMemoryCandidate(entry))
      .filter(Boolean);
    if (normalizedItems.length > 0) {
      pendingMemoryCandidatesBySessionId.set(normalizedSessionId, normalizedItems);
    } else {
      pendingMemoryCandidatesBySessionId.delete(normalizedSessionId);
    }
    return normalizedItems;
  }

  function getPendingMemoryCandidates(session = null) {
    const sessionId = normalizeSessionId(
      session?.id
      || getFocusedSessionId()
      || getCurrentSessionIdSafe(),
    );
    if (!sessionId) return [];
    return pendingMemoryCandidatesBySessionId.get(sessionId) || [];
  }

  async function refreshMemoryCandidates(sessionIdOverride = "", { force = false } = {}) {
    const targetSessionId = normalizeSessionId(
      sessionIdOverride
      || getFocusedSessionId()
      || getCurrentSessionIdSafe(),
    );
    if (!targetSessionId) return [];
    if (!force && memoryCandidateRefreshInFlightBySessionId.has(targetSessionId)) {
      return memoryCandidateRefreshInFlightBySessionId.get(targetSessionId);
    }
    if (!force && pendingMemoryCandidatesBySessionId.has(targetSessionId)) {
      return pendingMemoryCandidatesBySessionId.get(targetSessionId) || [];
    }
    const request = (async () => {
      try {
        const response = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(targetSessionId)}/memory-candidates`);
        return setPendingMemoryCandidatesForSession(targetSessionId, response?.memoryCandidates);
      } catch {
        return pendingMemoryCandidatesBySessionId.get(targetSessionId) || [];
      } finally {
        memoryCandidateRefreshInFlightBySessionId.delete(targetSessionId);
      }
    })();
    memoryCandidateRefreshInFlightBySessionId.set(targetSessionId, request);
    return request;
  }

  async function reviewMemoryCandidate(candidate = null, status = "", session = null) {
    const sessionId = normalizeSessionId(session?.id || candidate?.sessionId || getFocusedSessionId() || getCurrentSessionIdSafe());
    const candidateId = String(candidate?.id || "").trim();
    const nextStatus = String(status || "").trim().toLowerCase();
    if (!sessionId || !candidateId || !nextStatus) return null;
    try {
      await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(sessionId)}/memory-candidates/${encodeURIComponent(candidateId)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      await refreshMemoryCandidates(sessionId, { force: true });
      renderTracker();
      return true;
    } catch (error) {
      console.warn("[quest] Failed to review memory candidate:", error?.message || error);
      return false;
    }
  }

  function normalizeLiveTaskCardText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeLiveTaskCardList(value) {
    return Array.isArray(value)
      ? value.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
      : [];
  }

  function normalizeLiveTaskCardPreview(taskCard) {
    if (!taskCard || typeof taskCard !== "object" || Array.isArray(taskCard)) return null;
    const nextTaskCard = {};
    for (const key of LIVE_TASK_CARD_SCALAR_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(taskCard, key)) continue;
      const normalizedValue = normalizeLiveTaskCardText(taskCard[key]);
      if (key === "lineRole") {
        nextTaskCard[key] = normalizedValue.toLowerCase() === "branch" ? "branch" : "main";
        continue;
      }
      nextTaskCard[key] = normalizedValue;
    }
    for (const key of LIVE_TASK_CARD_ARRAY_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(taskCard, key)) continue;
      nextTaskCard[key] = normalizeLiveTaskCardList(taskCard[key]);
    }
    return Object.keys(nextTaskCard).length > 0 ? nextTaskCard : null;
  }

  function mergeLiveTaskCard(baseTaskCard = null, previewTaskCard = null) {
    if (!previewTaskCard) return baseTaskCard;
    const nextTaskCard = baseTaskCard && typeof baseTaskCard === "object"
      ? { ...baseTaskCard }
      : { version: 1, mode: "task" };
    for (const key of LIVE_TASK_CARD_SCALAR_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(previewTaskCard, key)) continue;
      nextTaskCard[key] = previewTaskCard[key];
    }
    for (const key of LIVE_TASK_CARD_ARRAY_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(previewTaskCard, key)) continue;
      nextTaskCard[key] = [...previewTaskCard[key]];
    }
    return nextTaskCard;
  }

  function getLiveTaskCardPreview(session = null) {
    const sessionId = normalizeSessionId(session?.id || "");
    if (!sessionId) return null;
    const runState = String(session?.activity?.run?.state || "").trim().toLowerCase();
    if (runState !== "running") {
      liveTaskCardPreviewBySessionId.delete(sessionId);
      return null;
    }
    return liveTaskCardPreviewBySessionId.get(sessionId)?.taskCard || null;
  }

  function withLiveTaskCardPreview(session = null) {
    if (!session || typeof session !== "object") return null;
    const previewTaskCard = getLiveTaskCardPreview(session);
    if (!previewTaskCard) return session;
    return {
      ...session,
      taskCard: mergeLiveTaskCard(
        session?.taskCard && typeof session.taskCard === "object" ? session.taskCard : null,
        previewTaskCard,
      ),
    };
  }

  function setLiveTaskCardPreview(taskCard, options = {}) {
    const sessionId = normalizeSessionId(options.sessionId || getCurrentSessionIdSafe());
    if (!sessionId) return false;
    const normalizedTaskCard = normalizeLiveTaskCardPreview(taskCard);
    if (!normalizedTaskCard) return false;
    const sourceSeq = Number.isInteger(options.sourceSeq) ? options.sourceSeq : 0;
    const currentEntry = liveTaskCardPreviewBySessionId.get(sessionId) || null;
    const currentSeq = Number.isInteger(currentEntry?.sourceSeq) ? currentEntry.sourceSeq : 0;
    if (sourceSeq > 0 && currentSeq > sourceSeq) return false;
    liveTaskCardPreviewBySessionId.set(sessionId, {
      taskCard: normalizedTaskCard,
      sourceSeq,
    });
    if (sessionId === getFocusedSessionId() || sessionId === getCurrentSessionIdSafe()) {
      renderTracker();
    }
    renderSessionSurfaceForLiveTaskCard(sessionId);
    return true;
  }

  function clearLiveTaskCardPreview(sessionId = "", options = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId || getCurrentSessionIdSafe());
    if (!normalizedSessionId) return false;
    const deleted = liveTaskCardPreviewBySessionId.delete(normalizedSessionId);
    if (
      deleted
      && options.render !== false
      && (normalizedSessionId === getFocusedSessionId() || normalizedSessionId === getCurrentSessionIdSafe())
    ) {
      renderTracker();
    }
    if (deleted) {
      renderSessionSurfaceForLiveTaskCard(normalizedSessionId);
    }
    return deleted;
  }

  function getCurrentSessionIdSafe() {
    return normalizeSessionId(getCurrentSessionSafe()?.id || "");
  }

  function renderSessionSurfaceForLiveTaskCard(sessionId = "") {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) return false;
    if (
      normalizedSessionId !== getCurrentSessionIdSafe()
      && normalizedSessionId !== getFocusedSessionId()
    ) {
      return false;
    }
    if (typeof renderSessionList === "function") {
      renderSessionList();
      return true;
    }
    return false;
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

  function ensureTrackerHandoffActionsEl() {
    if (trackerHandoffActionsEl) return trackerHandoffActionsEl;
    if (!trackerActionsEl) return null;
    trackerHandoffActionsEl = document.createElement("div");
    trackerHandoffActionsEl.className = "quest-tracker-handoff-actions";
    const beforeChild = trackerDetailToggleBtn?.parentNode === trackerActionsEl
      ? trackerDetailToggleBtn
      : (trackerActionsEl.firstChild || null);
    trackerActionsEl.insertBefore(trackerHandoffActionsEl, beforeChild);
    return trackerHandoffActionsEl;
  }

  function renderPersistentTrackerActions(session) {
    const visibleSession = getPersistentUiSession(session);
    trackerRenderer?.renderPersistentActions?.(visibleSession, {
      onComplete: () => {
        dispatchAction?.({ action: "complete_pending", sessionId: session.id });
      },
      onPromote: async () => {
        const title = String(session?.taskCard?.goal || session?.taskCard?.mainGoal || session?.name || session?.taskCard?.summary || "").trim() || "未命名长期项";
        const summary = String(session?.taskCard?.checkpoint || session?.taskCard?.summary || "").trim();
        const ok = await dispatchAction?.({
          action: "persistent_promote",
          sessionId: session.id,
          kind: "recurring_task",
          digest: { title, summary },
          execution: { mode: "in_place", runPrompt: "" },
        });
        if (ok === false) {
          console.error("[workbench] promote to persistent failed");
        }
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
        const sessionKind = String(session?.persistent?.kind || "").trim().toLowerCase();
        operationRecordController?.openPersistentEditor?.({
          mode: sessionKind ? "configure" : "promote",
        });
      },
      onAttachToLongTerm: async (targetSessionId = "") => {
        const normalizedTargetSessionId = normalizeSessionId(
          targetSessionId
          || session?.sessionState?.longTerm?.suggestion?.rootSessionId
          || "",
        );
        if (!session?.id || !normalizedTargetSessionId) return;
        const targetSession = getSessionRecord(normalizedTargetSessionId) || null;
        const targetTitle = String(
          session?.sessionState?.longTerm?.suggestion?.title
          || session?.sessionState?.longTerm?.rootTitle
          || targetSession?.name
          || "长期任务",
        ).trim();
        await reparentSessionUnderTarget(session.id, {
          targetSessionId: normalizedTargetSessionId,
          branchReason: `归入长期任务「${targetTitle}」下持续维护`,
        });
        setLongTermSuggestionSuppressed(session.id, normalizedTargetSessionId, false);
      },
      onDismissLongTermSuggestion: (targetSessionId = "") => {
        const normalizedTargetSessionId = normalizeSessionId(
          targetSessionId
          || session?.sessionState?.longTerm?.suggestion?.rootSessionId
          || "",
        );
        if (!session?.id || !normalizedTargetSessionId) return;
        setLongTermSuggestionSuppressed(session.id, normalizedTargetSessionId, true);
        renderTracker();
      },
      onOpenProjectPicker: () => {
        if (!session?.id) return;
        if (typeof window.openProjectPicker === "function") {
          window.openProjectPicker(session);
        }
      },
      onMoveBucket: async (targetBucket) => {
        if (!session?.id || !targetBucket) return;
        const ltMembership = session?.taskPoolMembership?.longTerm || null;
        if (!ltMembership?.projectSessionId) return;
        await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(session.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskPoolMembership: { longTerm: { ...ltMembership, bucket: targetBucket } },
          }),
        }).catch((err) => console.error("[tracker] move bucket failed:", err));
      },
      onRemoveFromProject: async () => {
        if (!session?.id) return;
        await fetchJsonOrRedirect(`/api/sessions/${encodeURIComponent(session.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskPoolMembership: { longTerm: null } }),
        }).catch((err) => console.error("[tracker] remove from project failed:", err));
      },
    });
  }

  function renderTaskHandoffTrackerActions(session) {
    const normalizedSourceSessionId = normalizeSessionId(session?.id || "");
    const targets = normalizedSourceSessionId ? listTaskHandoffTargets(normalizedSourceSessionId) : [];
    trackerRenderer?.renderHandoffActions?.(session, {
      targets,
      buildPreview: (targetSessionId, options = {}) => buildTaskHandoffPreview(
        normalizedSourceSessionId,
        targetSessionId,
        options,
      ),
      onHandoff: (targetSessionId, options = {}) => handoffSessionTaskData(normalizedSourceSessionId, {
        targetSessionId,
        detailLevel: String(options?.detailLevel || "").trim() || "balanced",
      }),
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
    if (!allowAutoOpen || taskCanvasAutoOpenSuppressed) {
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
    taskCanvasAutoOpenSuppressed = !selectedTaskCanvasNodeId;
    if (options.render !== false) {
      renderTracker();
    }
    notifyWorkbenchViewModel("task-canvas-select");
    return selectedTaskCanvasNodeId;
  }

  function clearTaskCanvasNode(options = {}) {
    selectedTaskCanvasNodeId = "";
    taskCanvasAutoOpenSuppressed = options.allowAutoOpen === true ? false : true;
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

  function setFocusedSessionId(sessionId, options = {}) {
    const nextFocusedSessionId = normalizeSessionId(sessionId) || getCurrentSessionIdSafe();
    const focusChanged = nextFocusedSessionId !== focusedSessionId;
    if (focusChanged) {
      questHasSessionTracked = false;
    }
    focusedSessionId = nextFocusedSessionId;
    if (focusChanged && options.render !== false) {
      invalidateTaskMapRail();
      renderTracker();
      if (options.renderSessionList === true && typeof renderSessionList === "function") {
        renderSessionList();
      }
    }
    if (focusChanged) {
      void refreshMemoryCandidates(nextFocusedSessionId, { force: false }).then(() => {
        if (getFocusedSessionId() === nextFocusedSessionId) {
          renderTracker();
        }
      });
    }
    if (focusChanged && operationRecordController?.isOpen?.()) {
      operationRecordController.handleFocusChange();
    }
    notifyWorkbenchViewModel("focused-session");
    return focusedSessionId;
  }

  function getTaskMapMockPreset() {
    try {
      const url = new URL(String(window?.location?.href || ""));
      return String(url.searchParams.get("taskMapMock") || "").trim();
    } catch {
      return "";
    }
  }

  function getTaskMapProjection() {
    const graphClient = getGraphClientApi();
    // When a long-term project is selected in the sidebar, use it as the map root
    const projectOverride = typeof window.getSelectedLongTermProjectId === "function"
      ? window.getSelectedLongTermProjectId()
      : "";
    const targetSessionId = graphClient?.resolveTaskMapGraphRootSessionId?.({
      sessionId: projectOverride || getFocusedSessionId() || getCurrentSessionIdSafe(),
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
        // Filter out archived sessions — they should not appear on the canvas
        sessions: getSessionRecords().filter((s) => s?.archived !== true),
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
    const sourceRecords = typeof sessions !== "undefined" && Array.isArray(sessions)
      ? sessions
      : (Array.isArray(window.sessions) ? window.sessions : []);
    if (liveTaskCardPreviewBySessionId.size === 0) {
      return sourceRecords;
    }
    return sourceRecords.map((entry) => withLiveTaskCardPreview(entry) || entry);
  }

  function getSessionRecord(sessionId) {
    if (!sessionId) return null;
    return getSessionRecords().find((entry) => entry.id === sessionId) || null;
  }

  function getSessionDisplayName(session) {
    const taskCard = getTaskCard(session);
    const name = String(session?.name || "").trim();
    const goal = String(taskCard?.goal || "").trim();
    const mainGoal = String(taskCard?.mainGoal || "").trim();
    const isBranch = String(taskCard?.lineRole || "").trim().toLowerCase() === "branch"
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

  const HANDOFF_PREVIEW_LIMITS = Object.freeze({
    focused: Object.freeze({
      focus: 2,
      conclusions: 2,
      integration: 2,
    }),
    balanced: Object.freeze({
      focus: 2,
      conclusions: 3,
      integration: 2,
    }),
    full: Object.freeze({
      focus: 3,
      conclusions: 4,
      integration: 3,
    }),
  });

  const HANDOFF_PREVIEW_STOP_TOKENS = new Set([
    "任务",
    "当前",
    "当前任务",
    "目标",
    "目标任务",
    "主线",
    "支线",
    "继续",
    "推进",
    "整理",
    "处理",
    "阶段",
    "总结",
    "摘要",
    "背景",
    "下一步",
    "结论",
  ]);

  function dedupePreviewItems(items = []) {
    const results = [];
    const seen = new Set();
    for (const item of Array.isArray(items) ? items : []) {
      const normalized = clipText(item, 140);
      if (!normalized) continue;
      const key = normalizedComparableText(normalized);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      results.push(normalized);
    }
    return results;
  }

  function normalizedComparableText(value) {
    return normalizeComparableText(value)
      .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff]+/gu, "");
  }

  function buildHandoffPreviewTokenSet(value) {
    const comparable = normalizedComparableText(value).toLowerCase();
    if (!comparable) return new Set();

    const tokens = new Set();
    const asciiTokens = comparable.match(/[a-z0-9]{2,}/g) || [];
    for (const token of asciiTokens) {
      if (tokens.size >= 72) break;
      if (HANDOFF_PREVIEW_STOP_TOKENS.has(token)) continue;
      tokens.add(token);
    }

    const cjk = comparable.replace(/[^\u4e00-\u9fff]/g, "");
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= cjk.length - size; index += 1) {
        if (tokens.size >= 72) break;
        const token = cjk.slice(index, index + size);
        if (!token || HANDOFF_PREVIEW_STOP_TOKENS.has(token)) continue;
        tokens.add(token);
      }
    }

    return tokens;
  }

  function buildHandoffPreviewProfile(items = []) {
    const profile = new Set();
    for (const item of Array.isArray(items) ? items : []) {
      for (const token of buildHandoffPreviewTokenSet(item)) {
        profile.add(token);
      }
    }
    return profile;
  }

  function scoreHandoffPreviewItem(text, profile) {
    if (!text || !(profile instanceof Set) || profile.size === 0) return 0;
    let score = 0;
    for (const token of buildHandoffPreviewTokenSet(text)) {
      if (!profile.has(token)) continue;
      score += token.length >= 3 ? 2 : 1;
    }
    return score;
  }

  function prioritizeHandoffPreviewItems(items = [], profile, max = 3) {
    const normalized = dedupePreviewItems(items);
    if (normalized.length === 0) return [];
    if (!(profile instanceof Set) || profile.size === 0) {
      return normalized.slice(0, max);
    }
    const prioritized = normalized
      .map((item, index) => ({
        item,
        index,
        score: scoreHandoffPreviewItem(item, profile),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((entry) => entry.item);
    return dedupePreviewItems([
      ...prioritized,
      ...normalized,
    ]).slice(0, max);
  }

  function resolveHandoffPreviewDetailLevel(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(HANDOFF_PREVIEW_LIMITS, normalized)
      ? normalized
      : "balanced";
  }

  function buildTaskHandoffPreview(sourceSessionId, targetSessionId, options = {}) {
    const sourceSession = getSessionRecord(sourceSessionId) || null;
    const targetSession = getSessionRecord(targetSessionId) || null;
    const sourceTaskCard = getTaskCard(sourceSession) || {};
    const targetTaskCard = getTaskCard(targetSession) || {};
    const limits = HANDOFF_PREVIEW_LIMITS[resolveHandoffPreviewDetailLevel(options.detailLevel)];
    const sourceTitle = normalizeTitle(options.sourceTitle || getSessionDisplayName(sourceSession) || "源任务");
    const targetTitle = normalizeTitle(options.targetTitle || getSessionDisplayName(targetSession) || "目标任务");
    const pickList = (key, max = 3) => (
      Array.isArray(sourceTaskCard?.[key])
        ? sourceTaskCard[key].map((entry) => clipText(entry, 140)).filter(Boolean).slice(0, max)
        : []
    );
    const targetProfile = buildHandoffPreviewProfile([
      targetTaskCard?.goal,
      targetTaskCard?.mainGoal,
      targetTaskCard?.checkpoint,
      targetTaskCard?.summary,
      ...(Array.isArray(targetTaskCard?.knownConclusions) ? targetTaskCard.knownConclusions.slice(0, 2) : []),
    ]);
    const conclusions = prioritizeHandoffPreviewItems([
      ...pickList("knownConclusions", 3),
      clipText(sourceTaskCard?.checkpoint || sourceTaskCard?.summary || sourceTaskCard?.goal || sourceSession?.name || "", 140),
    ], targetProfile, limits.conclusions);
    const focus = dedupePreviewItems([
      sourceTaskCard?.goal ? `源任务目标：${clipText(sourceTaskCard.goal, 140)}` : "",
      targetTaskCard?.goal ? `目标任务目标：${clipText(targetTaskCard.goal, 140)}` : "",
      sourceTaskCard?.checkpoint ? `源任务检查点：${clipText(sourceTaskCard.checkpoint, 140)}` : "",
      targetTaskCard?.checkpoint ? `目标任务接入点：${clipText(targetTaskCard.checkpoint, 140)}` : "",
    ]).slice(0, limits.focus);
    const targetAnchor = clipText(
      targetTaskCard?.checkpoint
      || targetTaskCard?.goal
      || targetTaskCard?.mainGoal
      || "",
      140,
    );
    const integration = dedupePreviewItems([
      conclusions[0] && targetAnchor ? `围绕「${targetAnchor}」优先吸收：${conclusions[0]}` : "",
    ]).slice(0, limits.integration);
    const sections = [
      { key: "focus", label: "焦点", items: focus },
      { key: "conclusions", label: "结论", items: conclusions },
      { key: "integration", label: "接入建议", items: integration },
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
          detailLevel: typeof payload?.detailLevel === "string" ? payload.detailLevel : undefined,
        }),
      });
      if (response?.session) {
        replaceSessionRecord(response.session);
      }
      if (response?.snapshot) {
        snapshot = response.snapshot;
      }
      rememberRecentHandoffTarget(targetSessionId);
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

  function getSessionTaskManagementStatus(session) {
    const sessionStateModel = window?.MelodySyncSessionStateModel || null;
    const normalizedWorkflowState = typeof sessionStateModel?.normalizeSessionWorkflowState === "function"
      ? sessionStateModel.normalizeSessionWorkflowState(session?.workflowState || "")
      : normalizeStatusToken(session?.workflowState || "");
    if (normalizedWorkflowState === "done") {
      return { key: "done", rank: 3, label: "已完成" };
    }
    if (normalizedWorkflowState === "parked") {
      return { key: "parked", rank: 2, label: "已挂起" };
    }
    if (normalizedWorkflowState === "waiting_user") {
      return { key: "waiting_user", rank: 1, label: "等待输入" };
    }
    return { key: "active", rank: 0, label: "进行中" };
  }

  function collectReparentRecommendationTexts(session, fallbackTitle = "") {
    const taskCard = getTaskCard(session);
    return [
      fallbackTitle || getSessionDisplayName(session),
      taskCard?.goal,
      taskCard?.mainGoal,
      taskCard?.summary,
      taskCard?.checkpoint,
      taskCard?.branchReason,
      getTaskCardList(taskCard, "nextSteps")[0] || "",
      getTaskCardList(taskCard, "knownConclusions")[0] || "",
    ]
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
  }

  function buildComparableBigrams(values = []) {
    const bigrams = new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const compact = normalizeComparableText(value).replace(/\s+/g, "");
      if (compact.length < 2) continue;
      for (let index = 0; index < compact.length - 1; index += 1) {
        bigrams.add(compact.slice(index, index + 2));
        if (bigrams.size >= 96) return bigrams;
      }
    }
    return bigrams;
  }

  function countComparableOverlap(source = new Set(), target = new Set(), maxMatches = 12) {
    let matches = 0;
    for (const token of source) {
      if (!target.has(token)) continue;
      matches += 1;
      if (matches >= maxMatches) break;
    }
    return matches;
  }

  function scoreReparentTargetRelevance(sourceSession, targetSession, {
    sourceTitle = "",
    targetTitle = "",
  } = {}) {
    const sourceTexts = collectReparentRecommendationTexts(sourceSession, sourceTitle);
    const targetTexts = collectReparentRecommendationTexts(targetSession, targetTitle);
    const normalizedSourceTexts = sourceTexts.map((entry) => normalizeComparableText(entry)).filter(Boolean);
    const normalizedTargetTexts = targetTexts.map((entry) => normalizeComparableText(entry)).filter(Boolean);
    const sourceJoined = normalizedSourceTexts.join(" ");
    const targetJoined = normalizedTargetTexts.join(" ");
    let inclusionBonus = 0;

    for (const text of normalizedSourceTexts) {
      if (text.length < 2) continue;
      if (targetJoined.includes(text)) {
        inclusionBonus = Math.max(inclusionBonus, Math.min(4, Math.ceil(text.length / 3)));
      }
    }
    for (const text of normalizedTargetTexts) {
      if (text.length < 2) continue;
      if (sourceJoined.includes(text)) {
        inclusionBonus = Math.max(inclusionBonus, Math.min(4, Math.ceil(text.length / 3)));
      }
    }

    const bigramOverlap = countComparableOverlap(
      buildComparableBigrams(sourceTexts),
      buildComparableBigrams(targetTexts),
      10,
    );

    return inclusionBonus + bigramOverlap;
  }

  function buildReparentTargetDisplayPath({
    title = "",
    path = "顶层任务",
    sameCluster = false,
    isRecent = false,
    relatedScore = 0,
    status = { key: "active", label: "" },
  } = {}) {
    const tags = [];
    if (relatedScore >= 3) {
      tags.push("相关内容");
    } else if (sameCluster) {
      tags.push("同图谱");
    }
    if (isRecent) {
      tags.push("最近使用");
    }
    if (status?.key === "waiting_user" || status?.key === "parked" || status?.key === "done") {
      tags.push(status.label || "");
    }
    const basePath = path === "顶层任务" ? (title || "顶层任务") : path;
    return tags.filter(Boolean).length > 0
      ? `${tags.filter(Boolean).join(" · ")} · ${basePath}`
      : basePath;
  }

  function buildConnectTargetDisplayPath({
    title = "",
    path = "当前任务",
    sameCluster = false,
    isRecent = false,
    relatedScore = 0,
    status = { key: "active", label: "" },
  } = {}) {
    const tags = [];
    if (relatedScore >= 3) {
      tags.push("相关内容");
    } else if (sameCluster) {
      tags.push("同图谱");
    }
    if (isRecent) {
      tags.push("最近使用");
    }
    if (status?.key === "waiting_user" || status?.key === "parked" || status?.key === "done") {
      tags.push(status.label || "");
    }
    const basePath = path === "顶层任务" ? (title || "当前任务") : path;
    return tags.filter(Boolean).length > 0
      ? `${tags.filter(Boolean).join(" · ")} · ${basePath}`
      : basePath;
  }

  function collectExistingConnectedSessionIds(sourceSessionId) {
    const normalizedSourceSessionId = normalizeSessionId(sourceSessionId);
    if (!normalizedSourceSessionId) return new Set();

    const graphs = [];
    const projection = getTaskMapProjection();
    if (Array.isArray(projection?.mainQuests) && projection.mainQuests.length > 0) {
      graphs.push(...projection.mainQuests);
    } else if (snapshot?.taskMapGraph && typeof snapshot.taskMapGraph === "object") {
      graphs.push(snapshot.taskMapGraph);
    }

    const connectedSessionIds = new Set();
    for (const graph of graphs) {
      const nodeById = new Map(
        (Array.isArray(graph?.nodes) ? graph.nodes : [])
          .filter((node) => normalizeTaskMapNodeId(node?.id))
          .map((node) => [normalizeTaskMapNodeId(node.id), node]),
      );
      for (const edge of Array.isArray(graph?.edges) ? graph.edges : []) {
        const edgeType = normalizeStatusToken(edge?.type || edge?.variant || "");
        if (edgeType !== "related") continue;
        const fromNode = nodeById.get(normalizeTaskMapNodeId(edge?.fromNodeId || edge?.from || ""));
        const toNode = nodeById.get(normalizeTaskMapNodeId(edge?.toNodeId || edge?.to || ""));
        const fromSessionId = normalizeSessionId(fromNode?.sessionId || "");
        const toSessionId = normalizeSessionId(toNode?.sessionId || "");
        if (!fromSessionId || !toSessionId) continue;
        if (fromSessionId === normalizedSourceSessionId) {
          connectedSessionIds.add(toSessionId);
        }
        if (toSessionId === normalizedSourceSessionId) {
          connectedSessionIds.add(fromSessionId);
        }
      }
    }

    return connectedSessionIds;
  }

  function listReparentTargets(sourceSessionId) {
    const normalizedSourceSessionId = normalizeSessionId(sourceSessionId);
    if (!normalizedSourceSessionId) return [];
    const { entriesById, childrenByParent } = collectTaskMapSessionEntries();
    const sourceEntry = entriesById.get(normalizedSourceSessionId) || null;
    const sourceSession = sourceEntry?.session || getSessionRecord(normalizedSourceSessionId) || null;
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
        title: "移出为独立任务",
        path: "从当前父任务下移出",
        sameCluster: true,
        depth: -1,
        searchText: normalizeComparableText("移出为独立任务 从当前父任务下移出"),
      });
    }

    for (const entry of entriesById.values()) {
      if (!entry?.sessionId || sourceSubtreeIds.has(entry.sessionId)) continue;
      if (entry?.session?.archived === true) continue;
      const path = buildSessionPathLabel(entry.sessionId, entriesById);
      const recentIndex = recentTargetIndex.has(entry.sessionId)
        ? recentTargetIndex.get(entry.sessionId)
        : Number.POSITIVE_INFINITY;
      const isRecent = Number.isFinite(recentIndex);
      const status = getSessionTaskManagementStatus(entry.session);
      const relatedScore = scoreReparentTargetRelevance(sourceSession, entry.session, {
        sourceTitle: sourceEntry?.title || getSessionDisplayName(sourceSession),
        targetTitle: entry.title || getSessionDisplayName(entry.session),
      });
      targets.push({
        mode: "attach",
        sessionId: entry.sessionId,
        title: entry.title || getSessionDisplayName(entry.session),
        path,
        displayPath: buildReparentTargetDisplayPath({
          title: entry.title || getSessionDisplayName(entry.session),
          path,
          sameCluster: normalizeSessionId(entry.clusterRootSessionId) === sourceClusterRootSessionId,
          isRecent,
          relatedScore,
          status,
        }),
        sameCluster: normalizeSessionId(entry.clusterRootSessionId) === sourceClusterRootSessionId,
        recentIndex,
        relatedScore,
        statusKey: status.key,
        statusRank: status.rank,
        depth: Number.isFinite(entry.depth) ? entry.depth : 0,
        searchText: normalizeComparableText([
          entry.title || "",
          path,
          ...collectReparentRecommendationTexts(entry.session, entry.title || ""),
        ].join(" ")),
      });
    }

    return targets.sort((left, right) => {
      if (left.mode !== right.mode) return left.mode === "detach" ? -1 : 1;
      if ((left.statusRank || 0) !== (right.statusRank || 0)) {
        return (left.statusRank || 0) - (right.statusRank || 0);
      }
      if ((left.relatedScore || 0) !== (right.relatedScore || 0)) {
        return (right.relatedScore || 0) - (left.relatedScore || 0);
      }
      if (left.sameCluster !== right.sameCluster) return left.sameCluster ? -1 : 1;
      const leftRecentIndex = Number.isFinite(left.recentIndex) ? left.recentIndex : Number.POSITIVE_INFINITY;
      const rightRecentIndex = Number.isFinite(right.recentIndex) ? right.recentIndex : Number.POSITIVE_INFINITY;
      if (leftRecentIndex !== rightRecentIndex) return leftRecentIndex - rightRecentIndex;
      if ((left.depth || 0) !== (right.depth || 0)) return (left.depth || 0) - (right.depth || 0);
      return String(left.title || "").localeCompare(String(right.title || ""), "zh-Hans-CN");
    });
  }

  function listConnectTargets(sourceSessionId) {
    const normalizedSourceSessionId = normalizeSessionId(sourceSessionId);
    if (!normalizedSourceSessionId) return [];
    const { entriesById } = collectTaskMapSessionEntries();
    const sourceEntry = entriesById.get(normalizedSourceSessionId) || null;
    const sourceSession = sourceEntry?.session || getSessionRecord(normalizedSourceSessionId) || null;
    const sourceClusterRootSessionId = normalizeSessionId(sourceEntry?.clusterRootSessionId || "");
    const existingConnectedSessionIds = collectExistingConnectedSessionIds(normalizedSourceSessionId);
    const recentTargetIds = readRecentConnectTargetIds();
    const recentTargetIndex = new Map();
    recentTargetIds.forEach((sessionId, index) => {
      recentTargetIndex.set(sessionId, index);
    });
    const targets = [];

    for (const entry of entriesById.values()) {
      if (!entry?.sessionId || entry.sessionId === normalizedSourceSessionId) continue;
      if (entry?.session?.archived === true) continue;
      if (existingConnectedSessionIds.has(entry.sessionId)) continue;
      const path = buildSessionPathLabel(entry.sessionId, entriesById);
      const recentIndex = recentTargetIndex.has(entry.sessionId)
        ? recentTargetIndex.get(entry.sessionId)
        : Number.POSITIVE_INFINITY;
      const isRecent = Number.isFinite(recentIndex);
      const status = getSessionTaskManagementStatus(entry.session);
      const relatedScore = scoreReparentTargetRelevance(sourceSession, entry.session, {
        sourceTitle: sourceEntry?.title || getSessionDisplayName(sourceSession),
        targetTitle: entry.title || getSessionDisplayName(entry.session),
      });
      targets.push({
        mode: "connect",
        sessionId: entry.sessionId,
        title: entry.title || getSessionDisplayName(entry.session),
        path,
        displayPath: buildConnectTargetDisplayPath({
          title: entry.title || getSessionDisplayName(entry.session),
          path,
          sameCluster: normalizeSessionId(entry.clusterRootSessionId) === sourceClusterRootSessionId,
          isRecent,
          relatedScore,
          status,
        }),
        sameCluster: normalizeSessionId(entry.clusterRootSessionId) === sourceClusterRootSessionId,
        recentIndex,
        relatedScore,
        statusKey: status.key,
        statusRank: status.rank,
        depth: Number.isFinite(entry.depth) ? entry.depth : 0,
        searchText: normalizeComparableText([
          entry.title || "",
          path,
          ...collectReparentRecommendationTexts(entry.session, entry.title || ""),
        ].join(" ")),
      });
    }

    return targets.sort((left, right) => {
      if ((left.statusRank || 0) !== (right.statusRank || 0)) {
        return (left.statusRank || 0) - (right.statusRank || 0);
      }
      if ((left.relatedScore || 0) !== (right.relatedScore || 0)) {
        return (right.relatedScore || 0) - (left.relatedScore || 0);
      }
      if (left.sameCluster !== right.sameCluster) return left.sameCluster ? -1 : 1;
      const leftRecentIndex = Number.isFinite(left.recentIndex) ? left.recentIndex : Number.POSITIVE_INFINITY;
      const rightRecentIndex = Number.isFinite(right.recentIndex) ? right.recentIndex : Number.POSITIVE_INFINITY;
      if (leftRecentIndex !== rightRecentIndex) return leftRecentIndex - rightRecentIndex;
      if ((left.depth || 0) !== (right.depth || 0)) return (left.depth || 0) - (right.depth || 0);
      return String(left.title || "").localeCompare(String(right.title || ""), "zh-Hans-CN");
    });
  }

  function listTaskHandoffTargets(sourceSessionId) {
    const normalizedSourceSessionId = normalizeSessionId(sourceSessionId);
    if (!normalizedSourceSessionId) return [];
    const { entriesById } = collectTaskMapSessionEntries();
    const sourceEntry = entriesById.get(normalizedSourceSessionId) || null;
    const sourceSession = sourceEntry?.session || getSessionRecord(normalizedSourceSessionId) || null;
    const sourceClusterRootSessionId = normalizeSessionId(sourceEntry?.clusterRootSessionId || "");
    const recentTargetIds = readRecentHandoffTargetIds();
    const recentTargetIndex = new Map();
    recentTargetIds.forEach((sessionId, index) => {
      recentTargetIndex.set(sessionId, index);
    });
    const targets = [];

    for (const entry of entriesById.values()) {
      if (!entry?.sessionId || entry.sessionId === normalizedSourceSessionId) continue;
      if (entry?.session?.archived === true) continue;
      const path = buildSessionPathLabel(entry.sessionId, entriesById);
      const recentIndex = recentTargetIndex.has(entry.sessionId)
        ? recentTargetIndex.get(entry.sessionId)
        : Number.POSITIVE_INFINITY;
      const isRecent = Number.isFinite(recentIndex);
      const status = getSessionTaskManagementStatus(entry.session);
      const relatedScore = scoreReparentTargetRelevance(sourceSession, entry.session, {
        sourceTitle: sourceEntry?.title || getSessionDisplayName(sourceSession),
        targetTitle: entry.title || getSessionDisplayName(entry.session),
      });
      targets.push({
        mode: "handoff",
        sessionId: entry.sessionId,
        title: entry.title || getSessionDisplayName(entry.session),
        path,
        displayPath: buildConnectTargetDisplayPath({
          title: entry.title || getSessionDisplayName(entry.session),
          path,
          sameCluster: normalizeSessionId(entry.clusterRootSessionId) === sourceClusterRootSessionId,
          isRecent,
          relatedScore,
          status,
        }),
        sameCluster: normalizeSessionId(entry.clusterRootSessionId) === sourceClusterRootSessionId,
        recentIndex,
        relatedScore,
        statusKey: status.key,
        statusRank: status.rank,
        depth: Number.isFinite(entry.depth) ? entry.depth : 0,
        searchText: normalizeComparableText([
          entry.title || "",
          path,
          ...collectReparentRecommendationTexts(entry.session, entry.title || ""),
        ].join(" ")),
      });
    }

    return targets.sort((left, right) => {
      if ((left.statusRank || 0) !== (right.statusRank || 0)) {
        return (left.statusRank || 0) - (right.statusRank || 0);
      }
      if ((left.relatedScore || 0) !== (right.relatedScore || 0)) {
        return (right.relatedScore || 0) - (left.relatedScore || 0);
      }
      if (left.sameCluster !== right.sameCluster) return left.sameCluster ? -1 : 1;
      const leftRecentIndex = Number.isFinite(left.recentIndex) ? left.recentIndex : Number.POSITIVE_INFINITY;
      const rightRecentIndex = Number.isFinite(right.recentIndex) ? right.recentIndex : Number.POSITIVE_INFINITY;
      if (leftRecentIndex !== rightRecentIndex) return leftRecentIndex - rightRecentIndex;
      if ((left.depth || 0) !== (right.depth || 0)) return (left.depth || 0) - (right.depth || 0);
      return String(left.title || "").localeCompare(String(right.title || ""), "zh-Hans-CN");
    });
  }

  function getTaskCard(session) {
    if (!session || typeof session !== "object") return null;
    return mergeLiveTaskCard(
      session?.taskCard && typeof session.taskCard === "object" ? session.taskCard : null,
      getLiveTaskCardPreview(session),
    );
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

  function normalizePersistentKind(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizePersistentRuntimeMode(value) {
    return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  }

  function normalizeTimeOfDay(value) {
    const text = String(value || "").trim();
    if (!/^\d{1,2}:\d{2}$/.test(text)) return "";
    const [hourText, minuteText] = text.split(":");
    const hour = Number.parseInt(hourText, 10);
    const minute = Number.parseInt(minuteText, 10);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return "";
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function formatPersistentRuntimeLabel(rule, fallbackLabel = "会话默认") {
    const mode = normalizePersistentRuntimeMode(rule?.mode || "");
    if (mode === "pinned") {
      const runtime = rule?.runtime && typeof rule.runtime === "object" ? rule.runtime : {};
      const parts = [
        String(runtime.tool || "").trim(),
        String(runtime.model || "").trim(),
        String(runtime.effort || "").trim() ? `思考 ${String(runtime.effort || "").trim()}` : "",
      ].filter(Boolean);
      return parts.join(" · ") || "固定服务";
    }
    if (mode === "follow_current") return "跟随当前所选";
    if (mode === "session_default") return "会话默认";
    return fallbackLabel;
  }

  function formatRecurringCadenceLabel(recurring = {}) {
    const cadence = String(recurring?.cadence || "").trim().toLowerCase();
    const timeOfDay = normalizeTimeOfDay(recurring?.timeOfDay || "");
    if (cadence === "hourly") return "每小时";
    if (cadence === "weekly") {
      const labels = ["日", "一", "二", "三", "四", "五", "六"];
      const days = Array.isArray(recurring?.weekdays)
        ? recurring.weekdays
          .map((entry) => Number.parseInt(String(entry || "").trim(), 10))
          .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6)
          .map((entry) => `周${labels[entry]}`)
        : [];
      const dayText = days.length > 0 ? days.join(" / ") : "每周";
      return timeOfDay ? `${dayText} ${timeOfDay}` : dayText;
    }
    return timeOfDay ? `每天 ${timeOfDay}` : "每天";
  }

  function createPersistentSummaryChip(label, tone = "") {
    const chip = document.createElement("div");
    chip.className = `quest-tracker-persistent-chip${tone ? ` is-${tone}` : ""}`;
    chip.textContent = label;
    return chip;
  }

  function clearPersistentSummary() {
    if (!trackerPersistentSummaryEl) return;
    trackerPersistentSummaryEl.hidden = true;
    trackerPersistentSummaryEl.innerHTML = "";
  }

  function getLongTermTrackerState(session) {
    const longTerm = session?.sessionState?.longTerm;
    if (!longTerm || typeof longTerm !== "object" || Array.isArray(longTerm)) return null;
    const suggestion = longTerm?.suggestion && typeof longTerm.suggestion === "object" && !Array.isArray(longTerm.suggestion)
      ? longTerm.suggestion
      : null;
    return {
      lane: String(longTerm?.lane || "").trim().toLowerCase() === "long-term" ? "long-term" : "sessions",
      role: String(longTerm?.role || "").trim().toLowerCase(),
      rootSessionId: String(longTerm?.rootSessionId || "").trim(),
      rootTitle: String(longTerm?.rootTitle || "").trim(),
      rootSummary: String(longTerm?.rootSummary || "").trim(),
      suggestion: suggestion
        ? {
          rootSessionId: String(suggestion?.rootSessionId || "").trim(),
          title: String(suggestion?.title || "").trim(),
          summary: String(suggestion?.summary || "").trim(),
        }
        : null,
    };
  }

  function getLongTermSuggestionSuppressedStorageKey(sessionId, rootSessionId) {
    return `${LONG_TERM_SUGGESTION_SUPPRESSED_PREFIX}:${String(sessionId || "").trim()}:${String(rootSessionId || "").trim()}`;
  }

  function isLongTermSuggestionSuppressed(sessionId, rootSessionId) {
    if (!sessionId || !rootSessionId) return false;
    return localStorage.getItem(getLongTermSuggestionSuppressedStorageKey(sessionId, rootSessionId)) === "1";
  }

  function setLongTermSuggestionSuppressed(sessionId, rootSessionId, suppressed = true) {
    if (!sessionId || !rootSessionId) return;
    if (suppressed) {
      localStorage.setItem(getLongTermSuggestionSuppressedStorageKey(sessionId, rootSessionId), "1");
      return;
    }
    localStorage.removeItem(getLongTermSuggestionSuppressedStorageKey(sessionId, rootSessionId));
  }

  function getPersistentUiSession(session) {
    const longTermState = getLongTermTrackerState(session);
    const suggestionRootSessionId = String(longTermState?.suggestion?.rootSessionId || "").trim();
    if (!session?.id || !suggestionRootSessionId || !isLongTermSuggestionSuppressed(session.id, suggestionRootSessionId)) {
      return session;
    }
    const rawLongTerm = session?.sessionState?.longTerm;
    if (!rawLongTerm || typeof rawLongTerm !== "object" || Array.isArray(rawLongTerm)) {
      return session;
    }
    return {
      ...session,
      sessionState: {
        ...(session.sessionState && typeof session.sessionState === "object" ? session.sessionState : {}),
        longTerm: {
          ...rawLongTerm,
          suggestion: null,
        },
      },
    };
  }

  function inferLongTermBucketFromSession(session) {
    // Delegate to single source in core/task-type-constants.js
    if (typeof window !== "undefined" && window.MelodySyncTaskTypeConstants?.inferSessionBucket) {
      return window.MelodySyncTaskTypeConstants.inferSessionBucket(session);
    }
    // Fallback (should not be reached if task-type-constants.js is loaded)
    const persistentKind = normalizePersistentKind(session?.persistent?.kind || "");
    if (persistentKind === "recurring_task") return "long_term";
    if (persistentKind === "scheduled_task") return "short_term";
    if (persistentKind === "waiting_task") return "waiting";
    if (persistentKind === "skill") return "skill";
    const workflowState = normalizeWorkflowState(session?.workflowState || "");
    if (workflowState === "waiting_user") return "waiting";
    return "inbox";
  }

  function getLongTermBucketSummaryEntries(session) {
    const sessionId = normalizeSessionId(session?.id || "");
    if (!sessionId) return [];
    const cluster = (Array.isArray(snapshot?.taskClusters) ? snapshot.taskClusters : []).find((entry) => (
      normalizeSessionId(entry?.mainSessionId || "") === sessionId
    )) || null;
    const counters = new Map();
    for (const branchSession of Array.isArray(cluster?.branchSessions) ? cluster.branchSessions : []) {
      const bucket = inferLongTermBucketFromSession(branchSession);
      counters.set(bucket, (counters.get(bucket) || 0) + 1);
    }
    const bucketDefs = (typeof window !== "undefined" && window.MelodySyncTaskTypeConstants?.BUCKET_DEFS) ||
      [
        { key: "long_term",  label: "长期任务" },
        { key: "short_term", label: "短期任务" },
        { key: "waiting",    label: "等待任务" },
        { key: "inbox",      label: "收集箱" },
      ];
    return bucketDefs
      .filter((entry) => entry.key !== "skill" && (counters.get(entry.key) || 0) > 0)
      .map((entry) => ({
        key: entry.key,
        label: entry.label,
        count: counters.get(entry.key) || 0,
      }));
  }

  function renderPersistentSummary(session) {
    if (!trackerPersistentSummaryEl) return;
    const visibleSession = getPersistentUiSession(session);
    const persistent = visibleSession?.persistent && typeof visibleSession.persistent === "object" ? visibleSession.persistent : null;
    const kind = normalizePersistentKind(persistent?.kind || "");
    const longTermState = getLongTermTrackerState(visibleSession);
    if (!visibleSession?.id) {
      clearPersistentSummary();
      return;
    }
    if ((!persistent || !kind) && !longTermState?.suggestion && !(longTermState?.lane === "long-term" && longTermState?.role === "member")) {
      clearPersistentSummary();
      return;
    }

    trackerPersistentSummaryEl.hidden = false;
    trackerPersistentSummaryEl.innerHTML = "";

    const kicker = document.createElement("div");
    kicker.className = "quest-tracker-persistent-kicker";

    const lead = document.createElement("div");
    lead.className = "quest-tracker-persistent-lead";

    const meta = document.createElement("div");
    meta.className = "quest-tracker-persistent-meta";

    if (kind === "recurring_task") {
      const cadenceLabel = formatRecurringCadenceLabel(persistent.recurring || {});
      const isPaused = String(persistent?.state || "").trim().toLowerCase() === "paused";
      const nextRunAt = formatTrackerTime(persistent?.recurring?.nextRunAt || "");
      const lastRunAt = formatTrackerTime(
        persistent?.recurring?.lastRunAt
          || persistent?.execution?.lastTriggerAt
          || "",
      );
      const runtimeLabel = formatPersistentRuntimeLabel(
        persistent?.runtimePolicy?.schedule,
        "会话默认",
      );

      kicker.textContent = "";
      lead.textContent = "";

      meta.appendChild(createPersistentSummaryChip(isPaused ? "已暂停" : "自动执行中", isPaused ? "paused" : "live"));
      if (cadenceLabel) meta.appendChild(createPersistentSummaryChip(cadenceLabel));
      if (nextRunAt) meta.appendChild(createPersistentSummaryChip(`下次 ${nextRunAt}`));
    } else if (kind === "scheduled_task") {
      const isPaused = String(persistent?.state || "").trim().toLowerCase() === "paused";
      const scheduledAt = formatTrackerTime(
        persistent?.scheduled?.nextRunAt
          || persistent?.scheduled?.runAt
          || "",
      );
      const lastRunAt = formatTrackerTime(
        persistent?.scheduled?.lastRunAt
          || persistent?.execution?.lastTriggerAt
          || "",
      );
      const runtimeLabel = formatPersistentRuntimeLabel(
        persistent?.runtimePolicy?.schedule,
        "会话默认",
      );

      kicker.textContent = "";
      lead.textContent = "";

      meta.appendChild(createPersistentSummaryChip(isPaused ? "已暂停" : "定时中", isPaused ? "paused" : "live"));
      if (scheduledAt) meta.appendChild(createPersistentSummaryChip(scheduledAt));
    } else if (kind === "waiting_task") {
      const runtimeLabel = formatPersistentRuntimeLabel(
        persistent?.runtimePolicy?.manual,
        "跟随当前所选",
      );
      const lastTriggerAt = formatTrackerTime(
        persistent?.execution?.lastTriggerAt
          || "",
      );

      kicker.textContent = "";
      lead.textContent = "";

      meta.appendChild(createPersistentSummaryChip("等待中", "active"));
      if (persistent?.knowledgeBasePath) {
        meta.appendChild(createPersistentSummaryChip(`知识库 ${persistent.knowledgeBasePath}`));
      }
    } else if (kind === "skill") {
      const runtimeLabel = formatPersistentRuntimeLabel(
        persistent?.runtimePolicy?.manual,
        "跟随当前所选",
      );
      const lastUsedAt = formatTrackerTime(
        persistent?.skill?.lastUsedAt
          || persistent?.execution?.lastTriggerAt
          || "",
      );

      kicker.textContent = "";
      lead.textContent = "";

      meta.appendChild(createPersistentSummaryChip("快捷按钮", "active"));
      if (lastUsedAt) meta.appendChild(createPersistentSummaryChip(`上次 ${lastUsedAt}`));
    } else if (longTermState?.suggestion?.rootSessionId) {
      const title = longTermState.suggestion.title || "长期任务";
      const summary = longTermState.suggestion.summary;
      kicker.textContent = "";
      lead.textContent = "";

      meta.appendChild(createPersistentSummaryChip(`建议归入 ${title}`, "active"));
      if (summary) {
        meta.appendChild(createPersistentSummaryChip(summary));
      }
    } else {
      clearPersistentSummary();
      return;
    }

    trackerPersistentSummaryEl.appendChild(kicker);
    trackerPersistentSummaryEl.appendChild(lead);
    trackerPersistentSummaryEl.appendChild(meta);
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
    if (!text) return "继续当前任务";
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
      clearPersistentSummary();
      if (taskMapRail) taskMapRail.hidden = true;
      if (trackerTaskListEl) trackerTaskListEl.hidden = true;
      if (headerTaskDetailBtn) headerTaskDetailBtn.hidden = true;
      if (headerTitleEl) headerTitleEl.hidden = true;
      taskCanvasAutoOpenSuppressed = false;
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
    tracker.classList.toggle("has-primary-detail", Boolean(trackerPrimaryDetail));
    tracker.classList.toggle("has-secondary-detail", Boolean(trackerSecondaryDetail));
    tracker.classList.toggle("is-detail-expanded", trackerDetailExpanded === true);
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
    if (headerTitleEl) headerTitleEl.hidden = true;
    tracker.hidden = !expanded;

    // ── Project badge row ──────────────────────────────────────────────────
    if (trackerProjectRowEl && trackerProjectNameEl) {
      const session = state?.session || null;
      const ltMembership = session?.taskPoolMembership?.longTerm;
      const ltProjectId = ltMembership?.projectSessionId
        ? String(ltMembership.projectSessionId).trim() : "";
      const ltRole = ltMembership?.role
        ? String(ltMembership.role).trim().toLowerCase() : "";
      const isLtMember = Boolean(ltProjectId && ltRole === "member");
      let projectName = "";
      if (isLtMember && typeof globalThis.getLongTermProjectList === "function") {
        const projects = globalThis.getLongTermProjectList() || [];
        const found = projects.find((p) => p?.id === ltProjectId);
        projectName = found ? String(found.name || "").trim() : "";
      }
      trackerProjectNameEl.textContent = projectName;
      trackerProjectRowEl.hidden = !projectName;
    }

    trackerTitleEl.textContent = trackerTitle;
    trackerTitleEl.hidden = false;
    const sessionTime = state.session?.lastEventAt || state.session?.updatedAt || state.session?.created || "";
    const timeText = formatTrackerTime(sessionTime);
    if (trackerBranchEl) {
      trackerBranchEl.hidden = !trackerPrimaryDetail;
      trackerBranchLabelEl.textContent = showBranch ? "补充信息" : "当前推进";
      trackerBranchTitleEl.textContent = trackerPrimaryDetail;
    }
    trackerNextEl.hidden = !trackerSecondaryDetail;
    trackerNextEl.classList.toggle("is-candidate-hint", Boolean(!showBranch && trackerSecondaryDetail));
    trackerNextEl.classList.toggle("is-next-step-hint", Boolean(showBranch && trackerSecondaryDetail));
    trackerNextEl.textContent = trackerSecondaryDetail;
    if (trackerTimeEl) {
      trackerTimeEl.hidden = true;
      trackerTimeEl.textContent = "";
    }
    renderPersistentSummary(state.session);
    if (trackerToggleBtn) {
      trackerToggleBtn.hidden = true;
    }
    trackerActionsEl?.classList.toggle("is-inline-links", Boolean(
      showBranch && (branchStatus === "active" || ["resolved", "merged", "parked"].includes(branchStatus))
    ));
    renderPersistentTrackerActions(state.session);
    renderTaskHandoffTrackerActions(state.session);
    branchActionController?.syncTrackerButtons(state);
    renderTaskMapRail(state);
    renderTrackerDetail(state);
    syncTrackerFooterVisibility();
    notifyWorkbenchViewModel("render");
  }

  function renderTrackerDetail(state) {
    const session = state?.session || null;
    trackerRenderer?.renderDetail(getTaskCard(session), trackerDetailExpanded, session, {
      primaryDetail: getTrackerPrimaryDetail(state),
    });
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
      await refreshMemoryCandidates(targetSessionId, { force: true });
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
      // Propagate systemProjectId to the session list so the sessions tab knows which project to show
      if (snapshot?.systemProjectId && typeof window.setSystemProjectId === "function") {
        window.setSystemProjectId(snapshot.systemProjectId);
      }
      await refreshTaskMapGraph(getFocusedSessionId() || getCurrentSessionIdSafe(), { force: false });
      await refreshMemoryCandidates(getFocusedSessionId() || getCurrentSessionIdSafe(), { force: false });
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
      branchReason: options.branchReason || (state.isBranch ? "从当前任务继续展开关联任务" : "从当前对话继续展开关联任务"),
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

  function inferTaskMapPlanSessionNodeKind(session = null) {
    const normalizedSessionId = normalizeSessionId(session?.id);
    const normalizedRootSessionId = normalizeSessionId(session?.rootSessionId || session?.id);
    return normalizedSessionId && normalizedSessionId === normalizedRootSessionId ? "main" : "branch";
  }

  function buildTaskConnectionNodeStub(session = null) {
    const sessionId = normalizeSessionId(session?.id);
    if (!sessionId) return null;
    const taskCard = getTaskCard(session);
    const status = getSessionTaskManagementStatus(session);
    return {
      id: `session:${sessionId}`,
      kind: inferTaskMapPlanSessionNodeKind(session),
      title: getSessionDisplayName(session),
      summary: clipText(
        taskCard?.summary
          || taskCard?.checkpoint
          || taskCard?.goal
          || taskCard?.mainGoal
          || "",
        72,
      ),
      sessionId,
      sourceSessionId: sessionId,
      status: status.key || "active",
      lineRole: String(taskCard?.lineRole || "").trim(),
    };
  }

  function buildTaskConnectionPlan(sourceSession = null, targetSession = null, { anchorSessionId = "" } = {}) {
    const sourceSessionId = normalizeSessionId(sourceSession?.id);
    const targetSessionId = normalizeSessionId(targetSession?.id);
    if (!sourceSessionId || !targetSessionId || sourceSessionId === targetSessionId) return null;
    const stablePair = [sourceSessionId, targetSessionId].sort((left, right) => left.localeCompare(right, "en"));
    const sourceNode = buildTaskConnectionNodeStub(sourceSession);
    const targetNode = buildTaskConnectionNodeStub(targetSession);
    if (!sourceNode || !targetNode) return null;
    return {
      id: `manual-related:${stablePair[0]}:${stablePair[1]}`,
      mode: "augment-default",
      activeNodeId: `session:${normalizeSessionId(anchorSessionId) || sourceSessionId}`,
      source: {
        type: "manual",
      },
      nodes: [sourceNode, targetNode],
      edges: [
        {
          id: `edge:related:${stablePair[0]}:${stablePair[1]}`,
          fromNodeId: sourceNode.id,
          toNodeId: targetNode.id,
          type: "related",
        },
      ],
    };
  }

  async function persistTaskConnectionPlan(sessionId, plan = null) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId || !plan) return null;
    return fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(normalizedSessionId)}/task-map-plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plan),
    });
  }

  async function connectSessionTasks(sessionId, options = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const normalizedTargetSessionId = normalizeSessionId(options?.targetSessionId || "");
    if (!normalizedSessionId || !normalizedTargetSessionId || normalizedSessionId === normalizedTargetSessionId) {
      return null;
    }
    const sourceSession = getSessionRecord(normalizedSessionId) || null;
    const targetSession = getSessionRecord(normalizedTargetSessionId) || null;
    if (!sourceSession || !targetSession) return null;

    const sourcePlan = buildTaskConnectionPlan(sourceSession, targetSession, {
      anchorSessionId: normalizedSessionId,
    });
    if (!sourcePlan) return null;
    let response = await persistTaskConnectionPlan(normalizedSessionId, sourcePlan);

    const sourceRootSessionId = normalizeSessionId(sourceSession?.rootSessionId || sourceSession?.id);
    const targetRootSessionId = normalizeSessionId(targetSession?.rootSessionId || targetSession?.id);
    if (sourceRootSessionId && targetRootSessionId && sourceRootSessionId !== targetRootSessionId) {
      const mirrorPlan = buildTaskConnectionPlan(targetSession, sourceSession, {
        anchorSessionId: normalizedTargetSessionId,
      });
      if (mirrorPlan) {
        const mirrorResponse = await persistTaskConnectionPlan(normalizedTargetSessionId, mirrorPlan);
        if (mirrorResponse?.snapshot) {
          response = mirrorResponse;
        }
      }
    }

    snapshot = response?.snapshot || snapshot;
    mergeSnapshotPatch(response);
    rememberRecentConnectTarget(normalizedTargetSessionId);
    await refreshTaskMapGraph(getFocusedSessionId() || getCurrentSessionIdSafe() || normalizedSessionId, { force: true });
    renderTracker();
    renderPathPanel();
    return response?.taskMapPlan || null;
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

  trackerProjectBtnEl?.addEventListener("click", () => {
    const session = getCurrentSessionSafe() || null;
    if (!session?.id) return;
    if (typeof window.openProjectPicker === "function") {
      window.openProjectPicker(session);
    }
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
    taskCanvasAutoOpenSuppressed = false;
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

  window.addEventListener("melodysync:status-change", (event) => {
    const session = event?.detail?.session || null;
    const sessionId = normalizeSessionId(event?.detail?.sessionId || session?.id || "");
    if (!sessionId) return;
    const nextRunState = String(session?.activity?.run?.state || "").trim().toLowerCase();
    const previousRunState = lastRunStateBySessionId.get(sessionId) || "";
    lastRunStateBySessionId.set(sessionId, nextRunState);
    if (nextRunState !== "running" || (previousRunState && previousRunState !== "running")) {
      clearLiveTaskCardPreview(sessionId, { render: false });
    }
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

  taskMapDrawerCloseBtn?.addEventListener("click", () => {
    setTaskMapDrawerExpanded(false);
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
    getSessionRecord,
    getSessionRecords,
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
    openPersistentEditor: (options = {}) => operationRecordController.openPersistentEditor(options),
    isTaskMapDrawerOpen: isMobileTaskMapDrawerOpen,
    getTaskMapRendererKind: () => String(taskMapFlowRenderer?.getRendererKind?.() || taskMapFlowRenderer?.rendererKind || "unknown"),
    selectTaskCanvasNode,
    clearTaskCanvasNode,
    applyLiveTaskCardPreview: withLiveTaskCardPreview,
    getLiveTaskCardPreview,
    setLiveTaskCardPreview,
    clearLiveTaskCardPreview,
    refreshOperationRecord: () => operationRecordController.refreshIfOpen(),
    refreshTaskMapForProject: async (projectSessionId) => {
      // Switch task map root to the selected long-term project
      const id = typeof projectSessionId === "string" ? projectSessionId.trim() : "";
      await refreshTaskMapGraph(id || getFocusedSessionId() || getCurrentSessionIdSafe(), { force: true });
      renderTracker();
    },
    // Lightweight re-render without fetching new data — used by node collapse toggle
    renderTracker: () => { renderTracker(); },
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
