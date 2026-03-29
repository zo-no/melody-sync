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
  const finishPanel = document.getElementById("questFinishPanel");
  const finishResolveBtn = document.getElementById("questFinishResolveBtn");
  const finishParkBtn = document.getElementById("questFinishParkBtn");
  const finishMergeBtn = document.getElementById("questFinishMergeBtn");
  const finishSummaryInput = document.getElementById("questFinishSummaryInput");
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
  let finishPanelOpen = false;
  let finishSummaryDraftBySession = new Map();
  let branchStructureExpanded = false;
  let focusedSessionId = "";
  let taskMindmapNodeExpansionState = new Map();
  let lastTaskMindmapRenderKey = "";

  function translate(key, vars) {
    return typeof window?.remotelabT === "function" ? window.remotelabT(key, vars) : key;
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
    if (typeof renderUiIcon === "function") {
      return renderUiIcon(expanded ? "chevron-down" : "chevron-right", className);
    }
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
    return isMobileQuestTracker() && branchStructureExpanded === true;
  }

  function getTrackerVisualStatus(session) {
    if (!session) {
      return {
        label: "空闲",
        dotClass: "",
      };
    }
    const archived = session?.archived === true;
    if (typeof getSessionVisualStatus === "function") {
      const visualStatus = getSessionVisualStatus(session) || {};
      if (archived && !visualStatus?.label) {
        return { label: "已归档", dotClass: "" };
      }
      return {
        label: archived && visualStatus?.label ? `${visualStatus.label} · 已归档` : (visualStatus?.label || (archived ? "已归档" : "空闲")),
        dotClass: String(visualStatus?.dotClass || "").replace(/^status-dot\s*/, "").trim(),
      };
    }
    return {
      label: archived ? "已归档" : "空闲",
      dotClass: "",
    };
  }

  function renderTrackerStatus(state) {
    if (!trackerStatusEl || !trackerStatusDotEl || !trackerStatusTextEl) return;
    if (!state?.hasSession || !state?.session) {
      trackerStatusEl.hidden = true;
      trackerStatusDotEl.className = "quest-tracker-status-dot";
      trackerStatusTextEl.textContent = "";
      return;
    }
    const visualStatus = getTrackerVisualStatus(state.session);
    trackerStatusEl.hidden = false;
    trackerStatusTextEl.textContent = visualStatus.label || "空闲";
    trackerStatusDotEl.className = `quest-tracker-status-dot${visualStatus.dotClass ? ` ${visualStatus.dotClass}` : ""}`;
  }

  function setTaskMapDrawerExpanded(expanded, options = {}) {
    const nextExpanded = expanded === true;
    if (branchStructureExpanded === nextExpanded && options.force !== true) {
      if (options.render === true) renderTracker();
      return;
    }
    branchStructureExpanded = nextExpanded;
    if (options.render !== false) {
      renderTracker();
    }
  }

  function syncTaskMapDrawerUi(isMounted) {
    const mobileDrawer = isMobileQuestTracker();
    const shouldMount = Boolean(isMounted);
    const drawerOpen = shouldMount && mobileDrawer && isMobileTaskMapDrawerOpen();
    if (taskMapRail) {
      taskMapRail.classList.toggle("is-mobile-drawer", mobileDrawer && shouldMount);
      taskMapRail.classList.toggle("is-mobile-open", drawerOpen);
      taskMapRail.setAttribute("aria-hidden", shouldMount && (!mobileDrawer || drawerOpen) ? "false" : "true");
    }
    if (taskMapDrawerBackdrop) {
      taskMapDrawerBackdrop.hidden = !(mobileDrawer && shouldMount && drawerOpen);
    }
    if (taskMapDrawerBtn) {
      taskMapDrawerBtn.hidden = !(mobileDrawer && shouldMount);
      taskMapDrawerBtn.setAttribute("aria-expanded", drawerOpen ? "true" : "false");
      taskMapDrawerBtn.title = drawerOpen ? "收起任务地图" : "展开任务地图";
      taskMapDrawerBtn.setAttribute("aria-label", taskMapDrawerBtn.title);
      setTaskMapButtonContent(taskMapDrawerBtn, drawerOpen);
    }
    if (trackerToggleBtn) {
      trackerToggleBtn.hidden = true;
    }
    document.body?.classList?.toggle?.("task-map-drawer-open", drawerOpen);
  }

  function getTrackerPrimaryTitle(state) {
    if (!state?.hasSession) return "当前任务";
    const baseTitle = state.isBranch
      ? (state.currentGoal || state.session?.name || state.mainGoal)
      : (state.currentGoal || state.mainGoal || state.session?.name);
    return toConciseGoal(baseTitle, isMobileQuestTracker() ? 44 : 64) || "当前任务";
  }

  function getTrackerPrimaryDetail(state) {
    if (!state?.hasSession) return "";
    if (state.isBranch) {
      return clipText(`来自主线：${state.branchFrom || state.mainGoal || "当前主线"}`, isMobileQuestTracker() ? 84 : 112);
    }
    return clipText(getCurrentTaskSummary(state), isMobileQuestTracker() ? 80 : 112);
  }

  function getTrackerSecondaryDetail(state, primaryDetail = "") {
    if (!state?.hasSession || !state?.isBranch) return "";
    const nextStep = clipText(state.nextStep || "", isMobileQuestTracker() ? 72 : 96);
    if (!nextStep) return "";
    return isRedundantTrackerText(nextStep, state.currentGoal, primaryDetail) ? "" : nextStep;
  }

  function getBranchFinishSummarySeed(state = null) {
    const resolvedState = state || deriveQuestState();
    if (!resolvedState?.hasSession || !resolvedState?.isBranch) return "";
    return clipText(
      getTaskCardList(resolvedState.taskCard, "knownConclusions")[0]
      || resolvedState.taskCard?.summary
      || resolvedState.taskCard?.checkpoint
      || getTaskCardList(resolvedState.taskCard, "nextSteps")[0]
      || resolvedState.latestContext?.checkpointSummary
      || resolvedState.latestContext?.resumeHint
      || "",
      180,
    );
  }

  function rememberFinishSummaryDraft(sessionId = "", value = "") {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) return;
    const nextValue = String(value || "").trim();
    if (nextValue) {
      finishSummaryDraftBySession.set(normalizedSessionId, nextValue);
      return;
    }
    finishSummaryDraftBySession.delete(normalizedSessionId);
  }

  function resolveFinishSummaryDraft(state = null) {
    const resolvedState = state || deriveQuestState();
    const sessionId = normalizeSessionId(resolvedState?.session?.id || "");
    if (!sessionId) return "";
    return finishSummaryDraftBySession.get(sessionId) || getBranchFinishSummarySeed(resolvedState);
  }

  function syncFinishSummaryInput(state = null) {
    if (!finishSummaryInput) return;
    const resolvedState = state || deriveQuestState();
    finishSummaryInput.value = resolveFinishSummaryDraft(resolvedState);
  }

  function openFinishPanel(state = null) {
    const resolvedState = state || deriveQuestState();
    if (!resolvedState?.hasSession || !resolvedState?.isBranch) return;
    finishPanelOpen = true;
    if (finishPanel) finishPanel.hidden = false;
    syncFinishSummaryInput(resolvedState);
  }

  function closeFinishPanel(options = {}) {
    const targetSessionId = normalizeSessionId(options.sessionId || getFocusedSessionId());
    if (options.preserveDraft !== false && finishSummaryInput) {
      rememberFinishSummaryDraft(targetSessionId, finishSummaryInput.value);
    }
    finishPanelOpen = false;
    if (finishPanel) finishPanel.hidden = true;
  }

  function isMobileQuestTracker() {
    const viewportWidth = Number(window?.innerWidth || 0);
    return viewportWidth > 0 && viewportWidth <= 767;
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
    focusedSessionId = nextFocusedSessionId;
    const snapshotChanged = options.syncSnapshot === false
      ? false
      : applyFocusedSessionToSnapshot(nextFocusedSessionId);
    if ((focusChanged || snapshotChanged) && options.render !== false) {
      lastTaskMindmapRenderKey = "";
      renderTracker();
      if (options.renderSessionList === true && typeof renderSessionList === "function") {
        renderSessionList();
      }
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
    return toConciseGoal(goal || mainGoal || name || "当前任务", 56);
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

  function getClusterForSession(sessionId) {
    if (!sessionId) return null;
    const clusters = Array.isArray(snapshot.taskClusters) ? snapshot.taskClusters : [];
    const match = clusters.find((cluster) => (
      cluster?.mainSessionId === sessionId
      || cluster?.currentBranchSessionId === sessionId
      || (Array.isArray(cluster?.branchSessionIds) && cluster.branchSessionIds.includes(sessionId))
    )) || null;
    return match || buildLocalClusterForSession(sessionId);
  }

  function getActiveSessionContext(sessionId) {
    return (Array.isArray(snapshot.branchContexts) ? snapshot.branchContexts : []).find((entry) => (
      entry?.sessionId === sessionId
      && String(entry?.status || "active").toLowerCase() === "active"
    )) || null;
  }

  function getLatestSessionContext(sessionId) {
    const matches = (Array.isArray(snapshot.branchContexts) ? snapshot.branchContexts : []).filter((entry) => (
      entry?.sessionId === sessionId
    ));
    if (!matches.length) return null;
    return [...matches].sort((a, b) => {
      const left = Date.parse(a?.updatedAt || a?.createdAt || '') || 0;
      const right = Date.parse(b?.updatedAt || b?.createdAt || '') || 0;
      return right - left;
    })[0] || null;
  }

  function getBranchLineageForSession(sessionId, cluster = null) {
    const resolvedCluster = cluster || getClusterForSession(sessionId);
    if (!resolvedCluster) return [];
    const branchMap = new Map(
      (Array.isArray(resolvedCluster.branchSessions) ? resolvedCluster.branchSessions : [])
        .filter((entry) => entry?.id)
        .map((entry) => [entry.id, entry]),
    );
    const lineage = [];
    const visited = new Set();
    let cursorId = sessionId;
    while (cursorId && !visited.has(cursorId)) {
      visited.add(cursorId);
      if (cursorId === resolvedCluster.mainSessionId) {
        const mainSession = getSessionRecord(cursorId) || resolvedCluster.mainSession || null;
        if (mainSession) lineage.unshift(getSessionDisplayName(mainSession));
        break;
      }
      const branchSession = branchMap.get(cursorId) || getSessionRecord(cursorId) || null;
      if (!branchSession) break;
      lineage.unshift(getSessionDisplayName(branchSession));
      const latestContext = getLatestSessionContext(cursorId);
      cursorId = String(
        latestContext?.parentSessionId
        || branchSession?._branchParentSessionId
        || branchSession?.sourceContext?.parentSessionId
        || resolvedCluster.mainSessionId
        || "",
      ).trim();
    }
    const filtered = lineage.filter(Boolean);
    if (filtered.length > 0) return filtered;
    const session = getSessionRecord(sessionId);
    const mainGoal = normalizeTitle(session?.taskCard?.mainGoal || "");
    const currentGoal = normalizeTitle(session?.taskCard?.goal || session?.name || "");
    return [mainGoal, currentGoal].filter(Boolean);
  }

  function buildLocalClusterForSession(sessionId) {
    const current = getSessionRecord(sessionId) || getCurrentSessionSafe();
    if (!current?.id) return null;
    const currentTaskCard = getTaskCard(current) || null;
    const currentLineRole = String(currentTaskCard?.lineRole || "main").toLowerCase();
    const currentMainGoal = normalizeTitle(
      currentTaskCard?.mainGoal
      || currentTaskCard?.goal
      || current?.name
      || "当前任务",
    );
    if (currentLineRole !== "branch") {
      return {
        _isLocalFallback: true,
        mainSessionId: current.id,
        mainSession: current,
        mainGoal: currentMainGoal,
        currentBranchSessionId: "",
        branchCount: 0,
        branchSessionIds: [],
        branchSessions: [],
      };
    }

    const latestContext = getLatestSessionContext(current.id);
    const parentSessionId = String(
      latestContext?.parentSessionId
      || current?.sourceContext?.parentSessionId
      || "",
    ).trim();
    const root = parentSessionId ? (getSessionRecord(parentSessionId) || null) : null;
    const branchStatus = String(latestContext?.status || "active").toLowerCase() || "active";
    const branchSessions = [{
      ...current,
      _branchDepth: 1,
      _branchParentSessionId: root?.id || parentSessionId || "",
      _branchStatus: branchStatus,
    }];

    return {
      _isLocalFallback: true,
      mainSessionId: root?.id || "",
      mainSession: root || null,
      mainGoal: normalizeTitle(
        currentTaskCard?.mainGoal
        || root?.taskCard?.mainGoal
        || root?.taskCard?.goal
        || currentMainGoal
        || "当前任务",
      ),
      currentBranchSessionId: current.id,
      branchCount: branchSessions.length,
      branchSessionIds: branchSessions.map((entry) => entry.id),
      branchSessions,
    };
  }

  function summarizeBranchNames(branchSessions = [], currentSessionId = "") {
    const names = [];
    const seen = new Set();
    for (const entry of Array.isArray(branchSessions) ? branchSessions : []) {
      const name = normalizeTitle(getBranchDisplayName(entry));
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const isCurrent = currentSessionId && entry?.id === currentSessionId;
      names.push(isCurrent ? `${name}（当前）` : name);
      if (names.length >= 4) break;
    }
    return names;
  }

  function getClusterLeadSession(cluster) {
    const currentBranchId = getResolvedClusterCurrentBranchSessionId(cluster);
    if (currentBranchId) {
      const currentBranch = getSessionRecord(currentBranchId)
        || (Array.isArray(cluster?.branchSessions) ? cluster.branchSessions.find((entry) => entry?.id === currentBranchId) : null);
      if (currentBranch) return currentBranch;
    }
    const mainSessionId = String(cluster?.mainSessionId || "").trim();
    if (mainSessionId) {
      return getSessionRecord(mainSessionId) || cluster?.mainSession || null;
    }
    return cluster?.mainSession || null;
  }

  function getClusterTitle(cluster) {
    return normalizeTitle(
      cluster?.mainGoal
      || cluster?.mainSession?.taskCard?.mainGoal
      || cluster?.mainSession?.taskCard?.goal
      || cluster?.mainSession?.name
      || getClusterLeadSession(cluster)?.name
      || "当前任务",
    );
  }

  function getClusterSummary(cluster) {
    const currentBranchId = getResolvedClusterCurrentBranchSessionId(cluster);
    const currentBranch = currentBranchId
      ? (getSessionRecord(currentBranchId)
        || (Array.isArray(cluster?.branchSessions) ? cluster.branchSessions.find((entry) => entry?.id === currentBranchId) : null))
      : null;
    if (currentBranch && currentBranchId !== String(cluster?.mainSessionId || "").trim()) {
      return `当前子任务：${getBranchDisplayName(currentBranch)}`;
    }
    const leadSession = getClusterLeadSession(cluster);
    const nextStep = getTaskCardList(getTaskCard(leadSession), "nextSteps")[0] || "";
    if (nextStep) return clipText(nextStep, 88);
    const branchCount = Array.isArray(cluster?.branchSessions) ? cluster.branchSessions.length : 0;
    if (branchCount > 0) {
      return `包含 ${branchCount} 条子任务`;
    }
    return "";
  }

  function getCurrentTaskSummary(state) {
    if (!state?.hasSession) return "";
    if (state.isBranch) {
      return clipText(
        state.nextStep
        || normalizeTitle(state.branchFrom || state.mainGoal || "")
        || "继续推进这条支线",
        88,
      );
    }
    const nextStep = clipText(state.nextStep || "", 88);
    if (nextStep) return nextStep;
    const clusterSummary = getClusterSummary(state.cluster);
    if (clusterSummary) return clusterSummary;
    return "继续推进这项任务";
  }

  function getStructuredBranchSessions(cluster) {
    const branchSessions = Array.isArray(cluster?.branchSessions)
      ? cluster.branchSessions.filter((entry) => entry?.id)
      : [];
    if (!branchSessions.length) return [];

    const childrenByParent = new Map();
    for (const branchSession of branchSessions) {
      const parentId = typeof branchSession?._branchParentSessionId === "string" && branchSession._branchParentSessionId.trim()
        ? branchSession._branchParentSessionId.trim()
        : String(cluster?.mainSessionId || "").trim();
      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, []);
      }
      childrenByParent.get(parentId).push(branchSession);
    }

    const branchOrderMap = new Map(branchSessions.map((entry, index) => [entry.id, index]));
    const ordered = [];
    const visited = new Set();
    const sortChildren = (left, right) => {
      const leftOrder = branchOrderMap.get(left?.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = branchOrderMap.get(right?.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;

      const leftCreated = Date.parse(left?.createdAt || left?.created || left?.updatedAt || left?.lastEventAt || "") || 0;
      const rightCreated = Date.parse(right?.createdAt || right?.created || right?.updatedAt || right?.lastEventAt || "") || 0;
      if (leftCreated !== rightCreated) return leftCreated - rightCreated;

      return String(left?.id || "").localeCompare(String(right?.id || ""));
    };
    const appendTree = (parentId, fallbackDepth = 1) => {
      const children = [...(childrenByParent.get(parentId) || [])].sort(sortChildren);
      for (const child of children) {
        if (!child?.id || visited.has(child.id)) continue;
        visited.add(child.id);
        const resolvedDepth = Number.isFinite(child?._branchDepth)
          ? Math.max(1, Number(child._branchDepth))
          : fallbackDepth;
        ordered.push({
          ...child,
          _displayDepth: resolvedDepth,
        });
        appendTree(child.id, resolvedDepth + 1);
      }
    };

    appendTree(String(cluster?.mainSessionId || "").trim(), 1);
    for (const branchSession of [...branchSessions].sort(sortChildren)) {
      if (!branchSession?.id || visited.has(branchSession.id)) continue;
      ordered.push({
        ...branchSession,
        _displayDepth: Number.isFinite(branchSession?._branchDepth)
          ? Math.max(1, Number(branchSession._branchDepth))
          : 1,
      });
    }
    return ordered;
  }

  function getVisibleBranchEntries(state) {
    return getStructuredBranchSessions(
      state?.cluster,
    );
  }

  function getTaskMindmapActiveBranchId(state) {
    return getResolvedClusterCurrentBranchSessionId(
      state?.cluster,
      state?.isBranch ? state?.session?.id : (state?.focusedSessionId || state?.session?.id || ""),
    );
  }

  function getTaskMindmapCurrentLineageIds(cluster, currentBranchSessionId = "") {
    const branchById = new Map(
      (Array.isArray(cluster?.branchSessions) ? cluster.branchSessions : [])
        .filter((entry) => entry?.id)
        .map((entry) => [entry.id, entry]),
    );
    const lineageIds = new Set();
    let cursor = currentBranchSessionId ? (branchById.get(currentBranchSessionId) || null) : null;
    while (cursor?.id && !lineageIds.has(cursor.id)) {
      lineageIds.add(cursor.id);
      const parentId = typeof cursor?._branchParentSessionId === "string"
        ? cursor._branchParentSessionId.trim()
        : "";
      if (!parentId || parentId === String(cluster?.mainSessionId || "").trim()) break;
      cursor = branchById.get(parentId) || null;
    }
    return lineageIds;
  }

  function getTaskMindmapTreeState(cluster, currentBranchSessionId = "") {
    const branchSessions = Array.isArray(cluster?.branchSessions)
      ? cluster.branchSessions.filter((entry) => entry?.id)
      : [];
    if (!branchSessions.length) {
      return {
        rootSessionId: String(cluster?.mainSessionId || "").trim(),
        branchSessions: [],
        branchById: new Map(),
        childrenByParent: new Map(),
        currentLineageIds: new Set(),
      };
    }

    const rootSessionId = String(cluster?.mainSessionId || "").trim();
    const branchById = new Map(branchSessions.map((entry) => [entry.id, entry]));
    const currentLineageIds = getTaskMindmapCurrentLineageIds(cluster, currentBranchSessionId);
    const branchOrderMap = new Map(branchSessions.map((entry, index) => [entry.id, index]));
    const childrenByParent = new Map();
    for (const branchSession of branchSessions) {
      const parentId = typeof branchSession?._branchParentSessionId === "string" && branchSession._branchParentSessionId.trim()
        ? branchSession._branchParentSessionId.trim()
        : rootSessionId;
      const resolvedParentId = parentId && branchById.has(parentId) ? parentId : rootSessionId;
      if (!childrenByParent.has(resolvedParentId)) {
        childrenByParent.set(resolvedParentId, []);
      }
      childrenByParent.get(resolvedParentId).push(branchSession);
    }

    const compareBranches = (left, right) => {
      const leftOrder = branchOrderMap.get(left?.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = branchOrderMap.get(right?.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;

      const leftCreated = Date.parse(left?.createdAt || left?.created || left?.updatedAt || left?.lastEventAt || "") || 0;
      const rightCreated = Date.parse(right?.createdAt || right?.created || right?.updatedAt || right?.lastEventAt || "") || 0;
      if (leftCreated !== rightCreated) return leftCreated - rightCreated;

      return String(left?.id || "").localeCompare(String(right?.id || ""));
    };
    for (const [parentId, children] of childrenByParent.entries()) {
      childrenByParent.set(parentId, [...children].sort(compareBranches));
    }

    return {
      rootSessionId,
      branchSessions: [...branchSessions].sort(compareBranches),
      branchById,
      childrenByParent,
      currentLineageIds,
    };
  }

  function getTaskMindmapCurrentPath(treeState, activeBranchId = "") {
    const branchById = treeState?.branchById instanceof Map ? treeState.branchById : new Map();
    const path = [];
    const seen = new Set();
    let cursor = activeBranchId ? (branchById.get(activeBranchId) || null) : null;
    while (cursor?.id && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      path.unshift(cursor);
      const parentId = typeof cursor?._branchParentSessionId === "string"
        ? cursor._branchParentSessionId.trim()
        : "";
      if (!parentId || parentId === String(treeState?.rootSessionId || "").trim()) break;
      cursor = branchById.get(parentId) || null;
    }
    return path;
  }

  function getBranchRowSummary(branchSession) {
    const nextStep = getTaskCardList(getTaskCard(branchSession), "nextSteps")[0] || "";
    if (nextStep) return toConciseGoal(nextStep, 56);
    const branchStatus = String(branchSession?._branchStatus || "active").toLowerCase();
    if (branchStatus === "active") {
      return getBranchStatusUi(branchStatus).summary || "";
    }
    return "";
  }

  function getTaskMindmapRootSummary(state) {
    const activePath = String(state?.activeBranchChain || "").trim();
    if (activePath) return activePath;
    const nextStep = clipText(state?.nextStep || "", 88);
    if (nextStep) return nextStep;
    const branchNames = Array.isArray(state?.branchNames)
      ? state.branchNames.filter((entry) => typeof entry === "string" && entry.trim())
      : [];
    if (branchNames.length > 0) {
      return branchNames.slice(0, 3).join("、");
    }
    return "";
  }

  function getTaskMindmapRenderKey(state, treeState) {
    const branchEntries = Array.isArray(treeState?.branchSessions)
      ? treeState.branchSessions.map((entry) => [
        entry?.id || "",
        entry?._branchParentSessionId || "",
        entry?._branchStatus || "",
      ].join(":"))
      : [];
    const expansionKey = [...taskMindmapNodeExpansionState.entries()]
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
      .map(([sessionId, expanded]) => `${sessionId}:${expanded ? "1" : "0"}`)
      .join(",");
    return [
      state?.session?.id || "",
      getTaskMindmapActiveBranchId(state),
      state?.isBranch ? "branch" : "main",
      getTaskMindmapRootSummary(state),
      expansionKey,
      branchEntries.join("|"),
    ].join("||");
  }

  function syncTaskMindmapNodeExpansionState(treeState) {
    const validIds = new Set(
      Array.isArray(treeState?.branchSessions)
        ? treeState.branchSessions.map((entry) => String(entry?.id || "").trim()).filter(Boolean)
        : [],
    );
    for (const sessionId of [...taskMindmapNodeExpansionState.keys()]) {
      if (!validIds.has(sessionId)) {
        taskMindmapNodeExpansionState.delete(sessionId);
      }
    }
  }

  function isTaskMindmapNodeExpanded(sessionId, currentLineageIds, hasChildren) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId || !hasChildren) return false;
    if (taskMindmapNodeExpansionState.has(normalizedSessionId)) {
      return taskMindmapNodeExpansionState.get(normalizedSessionId) === true;
    }
    return currentLineageIds.has(normalizedSessionId);
  }

  function toggleTaskMindmapNode(sessionId, expanded) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return;
    taskMindmapNodeExpansionState.set(normalizedSessionId, Boolean(expanded));
    lastTaskMindmapRenderKey = "";
    renderTracker();
  }

  function syncProjectedTaskMapExpansionState(activeQuest) {
    const validIds = new Set(
      Array.isArray(activeQuest?.nodes)
        ? activeQuest.nodes.map((node) => String(node?.id || "").trim()).filter(Boolean)
        : [],
    );
    for (const nodeId of [...taskMindmapNodeExpansionState.keys()]) {
      if (!validIds.has(nodeId)) {
        taskMindmapNodeExpansionState.delete(nodeId);
      }
    }
  }

  function isProjectedTaskMapNodeExpanded(nodeId, currentPathNodeIds, hasChildren) {
    const normalizedNodeId = String(nodeId || "").trim();
    if (!normalizedNodeId || !hasChildren) return false;
    if (taskMindmapNodeExpansionState.has(normalizedNodeId)) {
      return taskMindmapNodeExpansionState.get(normalizedNodeId) === true;
    }
    return currentPathNodeIds.has(normalizedNodeId);
  }

  function toggleProjectedTaskMapNode(nodeId, expanded) {
    const normalizedNodeId = String(nodeId || "").trim();
    if (!normalizedNodeId) return;
    taskMindmapNodeExpansionState.set(normalizedNodeId, Boolean(expanded));
    lastTaskMindmapRenderKey = "";
    renderTracker();
  }

  function getProjectedTaskMapRenderKey(state, activeQuest) {
    const nodeEntries = Array.isArray(activeQuest?.nodes)
      ? activeQuest.nodes.map((node) => [
        node?.id || "",
        node?.parentNodeId || "",
        node?.status || "",
        node?.kind || "",
        node?.title || "",
      ].join(":"))
      : [];
    const expansionKey = [...taskMindmapNodeExpansionState.entries()]
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
      .map(([nodeId, expanded]) => `${nodeId}:${expanded ? "1" : "0"}`)
      .join(",");
    return [
      state?.session?.id || "",
      activeQuest?.id || "",
      activeQuest?.currentNodeId || "",
      expansionKey,
      nodeEntries.join("|"),
    ].join("||");
  }

  function getProjectedTaskMapRootSummary(activeQuest) {
    if (!activeQuest) return "";
    const currentNodeTitle = clipText(activeQuest.currentNodeTitle || "", 48);
    const questTitle = clipText(activeQuest.title || "", 48);
    if (currentNodeTitle && currentNodeTitle !== questTitle) {
      return currentNodeTitle;
    }
    const summary = clipText(activeQuest.summary || "", 96);
    if (summary) return summary;
    const candidateCount = Number(activeQuest?.counts?.candidateBranches || 0);
    const branchCount = Number(activeQuest?.counts?.activeBranches || 0)
      + Number(activeQuest?.counts?.parkedBranches || 0)
      + Number(activeQuest?.counts?.completedBranches || 0);
    if (branchCount > 0 || candidateCount > 0) {
      return `${branchCount} 条支线 · ${candidateCount} 条候选`;
    }
    return "";
  }

  function createTaskListItem({
    title,
    details = [],
    meta = "",
    metaClassName = "",
    current = false,
    onClick = null,
    status = "",
    extraClassName = "",
    expander = null,
  }) {
    const useButton = typeof onClick === "function" && !expander;
    const row = document.createElement(useButton ? "button" : "div");
    if (row.type !== undefined && useButton) {
      row.type = "button";
    }
    row.className = `quest-task-item${extraClassName ? ` ${extraClassName}` : ""}`;
    if (expander) row.classList.add("has-expander");
    if (current) row.classList.add("is-current", "is-static");
    if (!current && typeof onClick !== "function") row.classList.add("is-static");
    if (String(status || "").toLowerCase() === "resolved") row.classList.add("is-resolved");

    if (expander) {
      const expanderBtn = document.createElement("button");
      expanderBtn.type = "button";
      expanderBtn.className = `quest-task-item-expander${expander.expanded ? " is-expanded" : ""}`;
      expanderBtn.innerHTML = renderChevronIcon(expander.expanded, "quest-task-item-expander-icon");
      expanderBtn.setAttribute("aria-label", expander.expanded ? "收起子任务" : "展开子任务");
      expanderBtn.title = expander.expanded ? "收起子任务" : "展开子任务";
      expanderBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (typeof expander.onToggle === "function") expander.onToggle();
      });
      row.appendChild(expanderBtn);
    }

    const main = document.createElement("span");
    main.classList.add("quest-task-item-main");

    const titleEl = document.createElement("span");
    titleEl.classList.add("quest-task-item-title");
    titleEl.textContent = clipText(title, 64);
    titleEl.title = String(title || "").trim();
    main.appendChild(titleEl);

    for (const detail of Array.isArray(details) ? details : []) {
      const text = String(detail?.text || "").trim();
      if (!text) continue;
      const detailEl = document.createElement("span");
      detailEl.className = String(detail?.className || "quest-task-item-summary").trim() || "quest-task-item-summary";
      detailEl.textContent = clipText(text, Number(detail?.max) > 0 ? Number(detail.max) : 88);
      detailEl.title = text;
      main.appendChild(detailEl);
    }

    row.appendChild(main);

    if (meta) {
      const metaEl = document.createElement("span");
      metaEl.classList.add("quest-task-item-meta");
      if (metaClassName) {
        String(metaClassName).split(/\s+/).filter(Boolean).forEach((token) => metaEl.classList.add(token));
      }
      metaEl.textContent = meta;
      row.appendChild(metaEl);
    }

    if (current) {
      row.setAttribute("aria-current", "true");
    }
    if (typeof onClick === "function") {
      row.addEventListener("click", onClick);
    }
    return row;
  }

  function getProjectedTaskFlowConfig() {
    const mobile = isMobileQuestTracker();
    return {
      nodeWidth: mobile ? 152 : 176,
      rootWidth: mobile ? 176 : 208,
      nodeHeight: mobile ? 88 : 96,
      rootHeight: mobile ? 98 : 112,
      candidateHeight: mobile ? 108 : 120,
      levelGap: mobile ? 98 : 116,
      siblingGap: mobile ? 18 : 20,
      paddingX: mobile ? 144 : 220,
      paddingY: mobile ? 112 : 168,
      overscanX: mobile ? 220 : 360,
      overscanY: mobile ? 240 : 320,
    };
  }

  function getProjectedTaskFlowNodeChildren(node, nodeMap) {
    return Array.isArray(node?.childNodeIds)
      ? node.childNodeIds.map((childId) => nodeMap.get(childId)).filter(Boolean)
      : [];
  }

  function getProjectedTaskFlowNodeWidth(node, metrics) {
    return node?.parentNodeId ? metrics.nodeWidth : metrics.rootWidth;
  }

  function getProjectedTaskFlowNodeHeight(node, metrics) {
    if (!node?.parentNodeId) return metrics.rootHeight;
    if (node?.kind === "candidate") return metrics.candidateHeight;
    return metrics.nodeHeight;
  }

  function buildProjectedTaskFlowTree(nodeId, nodeMap) {
    const node = nodeMap.get(nodeId);
    if (!node) return null;
    return {
      node,
      children: getProjectedTaskFlowNodeChildren(node, nodeMap)
        .map((child) => buildProjectedTaskFlowTree(child.id, nodeMap))
        .filter(Boolean),
      width: 0,
      x: 0,
      y: 0,
      nodeWidth: 0,
      nodeHeight: 0,
    };
  }

  function measureProjectedTaskFlowTree(tree, metrics) {
    if (!tree) return 0;
    const nodeWidth = getProjectedTaskFlowNodeWidth(tree.node, metrics);
    if (!tree.children.length) {
      tree.width = nodeWidth;
      return tree.width;
    }
    const childWidths = tree.children.map((child) => measureProjectedTaskFlowTree(child, metrics));
    const childrenWidth = childWidths.reduce((sum, width) => sum + width, 0)
      + Math.max(0, tree.children.length - 1) * metrics.siblingGap;
    tree.width = Math.max(nodeWidth, childrenWidth);
    return tree.width;
  }

  function positionProjectedTaskFlowTree(tree, left, top, metrics) {
    if (!tree) return;
    tree.nodeWidth = getProjectedTaskFlowNodeWidth(tree.node, metrics);
    tree.nodeHeight = getProjectedTaskFlowNodeHeight(tree.node, metrics);
    tree.x = left + Math.max(0, (tree.width - tree.nodeWidth) / 2);
    tree.y = top;
    if (!tree.children.length) return;

    const childrenWidth = tree.children.reduce((sum, child) => sum + child.width, 0)
      + Math.max(0, tree.children.length - 1) * metrics.siblingGap;
    let cursor = left + Math.max(0, (tree.width - childrenWidth) / 2);
    const nextTop = top + tree.nodeHeight + metrics.levelGap;
    for (const child of tree.children) {
      positionProjectedTaskFlowTree(child, cursor, nextTop, metrics);
      cursor += child.width + metrics.siblingGap;
    }
  }

  function flattenProjectedTaskFlowTree(tree, results = []) {
    if (!tree) return results;
    results.push(tree);
    for (const child of tree.children) {
      flattenProjectedTaskFlowTree(child, results);
    }
    return results;
  }

  function collectProjectedTaskFlowEdges(tree, results = []) {
    if (!tree) return results;
    for (const child of tree.children) {
      results.push({
        fromX: tree.x + tree.nodeWidth / 2,
        fromY: tree.y + tree.nodeHeight,
        toX: child.x + child.nodeWidth / 2,
        toY: child.y,
        current: child.node?.isCurrent === true || child.node?.isCurrentPath === true,
        candidate: child.node?.kind === "candidate",
      });
      collectProjectedTaskFlowEdges(child, results);
    }
    return results;
  }

  function createSvgElement(tagName) {
    if (typeof document?.createElementNS === "function") {
      return document.createElementNS("http://www.w3.org/2000/svg", tagName);
    }
    return document.createElement(tagName);
  }

  function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return min;
    if (!Number.isFinite(min) && !Number.isFinite(max)) return value;
    if (!Number.isFinite(min)) return Math.min(value, max);
    if (!Number.isFinite(max)) return Math.max(value, min);
    return Math.min(Math.max(value, min), max);
  }

  function getProjectedTaskFlowNodeMeta(node, activeQuest) {
    if (node.kind === "candidate") return "可选";
    if (!node?.parentNodeId) return "进行中";
    return getBranchStatusUi(node.status).label;
  }

  function getProjectedTaskFlowNodeSummary(node, activeQuest) {
    if (!node) return "";
    if (!node.parentNodeId) {
      const currentNodeTitle = clipText(activeQuest?.currentNodeTitle || "", 40);
      if (currentNodeTitle && currentNodeTitle !== clipText(node.title || "", 40)) {
        return currentNodeTitle;
      }
      return clipText(node.summary || activeQuest?.summary || "", 72);
    }
    if (node.kind === "candidate") {
      return clipText(node.summary || "适合单独展开", 72);
    }
    return clipText(node.summary || "", 72);
  }

  function renderProjectedTaskFlowBoard({ activeQuest, nodeMap, rootNode, state }) {
    const metrics = getProjectedTaskFlowConfig();
    const tree = buildProjectedTaskFlowTree(rootNode.id, nodeMap);
    measureProjectedTaskFlowTree(tree, metrics);
    positionProjectedTaskFlowTree(tree, metrics.paddingX, metrics.paddingY, metrics);

    const entries = flattenProjectedTaskFlowTree(tree, []);
    const edges = collectProjectedTaskFlowEdges(tree, []);
    const canvasWidth = Math.max(
      metrics.rootWidth + metrics.paddingX * 2,
      ...entries.map((entry) => entry.x + entry.nodeWidth + metrics.paddingX),
    );
    const canvasHeight = Math.max(
      metrics.rootHeight + metrics.paddingY * 2,
      ...entries.map((entry) => entry.y + entry.nodeHeight + metrics.paddingY),
    );

    const board = document.createElement("div");
    board.className = "quest-task-mindmap-board is-spine quest-task-flow-shell";

    const scroll = document.createElement("div");
    scroll.className = "quest-task-flow-scroll";

    const canvas = document.createElement("div");
    canvas.className = "quest-task-flow-canvas";
    canvas.style.width = `${Math.ceil(canvasWidth)}px`;
    canvas.style.height = `${Math.ceil(canvasHeight)}px`;

    const svg = createSvgElement("svg");
    if (typeof svg.setAttribute === "function") {
      svg.setAttribute("class", "quest-task-flow-edges");
    } else {
      svg.className = "quest-task-flow-edges";
    }
    if (typeof svg.setAttribute === "function") {
      svg.setAttribute("viewBox", `0 0 ${Math.ceil(canvasWidth)} ${Math.ceil(canvasHeight)}`);
      svg.setAttribute("width", String(Math.ceil(canvasWidth)));
      svg.setAttribute("height", String(Math.ceil(canvasHeight)));
      svg.setAttribute("aria-hidden", "true");
    }

    for (const edge of edges) {
      const path = createSvgElement("path");
      const midY = edge.fromY + ((edge.toY - edge.fromY) * 0.48);
      if (typeof path.setAttribute === "function") {
        path.setAttribute("d", `M ${edge.fromX} ${edge.fromY} V ${midY} H ${edge.toX} V ${edge.toY}`);
        path.setAttribute("class", `quest-task-flow-edge${edge.current ? " is-current" : ""}${edge.candidate ? " is-candidate" : ""}`);
      } else {
        path.className = `quest-task-flow-edge${edge.current ? " is-current" : ""}${edge.candidate ? " is-candidate" : ""}`;
      }
      svg.appendChild(path);
    }
    canvas.appendChild(svg);

    const createCandidateAction = (node) => {
      const actionBtn = document.createElement("button");
      actionBtn.type = "button";
      actionBtn.className = "quest-branch-btn quest-branch-btn-primary quest-task-flow-node-action panzoom-exclude";
      actionBtn.textContent = "开启支线";
      const sourceSessionId = String(node?.sessionId || node?.sourceSessionId || "").trim();
      if (!sourceSessionId) {
        actionBtn.disabled = true;
        return actionBtn;
      }
      actionBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        actionBtn.disabled = true;
        try {
          setTaskMapDrawerExpanded(false, { render: false });
          await enterBranchFromSession(sourceSessionId, node.title, {
            branchReason: node?.parentNodeId
              ? `从「${nodeMap.get(node.parentNodeId)?.title || "当前节点"}」继续拆出独立支线`
              : "从当前任务拆出独立支线",
            checkpointSummary: node.title,
          });
        } finally {
          actionBtn.disabled = false;
        }
      });
      return actionBtn;
    };

    for (const entry of entries) {
      const node = entry.node;
      const isCandidate = node.kind === "candidate";
      const nodeEl = document.createElement(isCandidate ? "div" : "button");
      if (nodeEl.type !== undefined && !isCandidate) {
        nodeEl.type = "button";
      }
      nodeEl.className = "quest-task-flow-node";
      if (!node.parentNodeId) nodeEl.classList.add("is-root");
      if (isCandidate) nodeEl.classList.add("is-candidate");
      if (node.isCurrentPath) nodeEl.classList.add("is-current-path");
      if (node.isCurrent) nodeEl.classList.add("is-current");
      if (node.status === "parked") nodeEl.classList.add("is-parked");
      if (node.status === "resolved" || node.status === "merged") nodeEl.classList.add("is-resolved");
      nodeEl.style.left = `${entry.x}px`;
      nodeEl.style.top = `${entry.y}px`;
      nodeEl.style.width = `${entry.nodeWidth}px`;
      nodeEl.style.minHeight = `${entry.nodeHeight}px`;

      const badge = document.createElement("div");
      badge.className = "quest-task-flow-node-badge";
      badge.textContent = getProjectedTaskFlowNodeMeta(node, activeQuest);
      nodeEl.appendChild(badge);

      const titleEl = document.createElement("div");
      titleEl.className = "quest-task-flow-node-title";
      titleEl.textContent = clipText(node.title || "当前任务", isCandidate ? 22 : 28);
      titleEl.title = String(node.title || "").trim();
      nodeEl.appendChild(titleEl);

      const summary = getProjectedTaskFlowNodeSummary(node, activeQuest);
      if (summary) {
        const summaryEl = document.createElement("div");
        summaryEl.className = "quest-task-flow-node-summary";
        summaryEl.textContent = summary;
        summaryEl.title = summary;
        nodeEl.appendChild(summaryEl);
      }

      if (isCandidate) {
        nodeEl.appendChild(createCandidateAction(node));
      } else if (node.sessionId) {
        nodeEl.addEventListener("click", () => {
          const sessionRecord = getSessionRecord(node.sessionId) || state?.parentSession || state?.cluster?.mainSession || null;
          if (typeof attachSession === "function") {
            setTaskMapDrawerExpanded(false, { render: false });
            attachSession(node.sessionId, sessionRecord);
          }
        });
      }

      canvas.appendChild(nodeEl);
    }

    scroll.appendChild(canvas);
    board.appendChild(scroll);

    const focusEntries = entries.filter((entry) => entry?.node && (entry.node.isCurrent || entry.node.isCurrentPath || !entry.node.parentNodeId));
    const focusEntry = focusEntries[0] || entries.find((entry) => entry?.node?.isCurrent) || entries.find((entry) => entry?.node?.isCurrentPath) || entries[0];
    const focusBounds = focusEntries.length > 0
      ? focusEntries.reduce((acc, entry) => ({
        left: Math.min(acc.left, entry.x),
        right: Math.max(acc.right, entry.x + entry.nodeWidth),
        top: Math.min(acc.top, entry.y),
        bottom: Math.max(acc.bottom, entry.y + entry.nodeHeight),
      }), {
        left: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY,
      })
      : null;
    const focusCenterX = focusBounds
      ? ((focusBounds.left + focusBounds.right) / 2)
      : (focusEntry ? (focusEntry.x + focusEntry.nodeWidth / 2) : (tree.x + tree.nodeWidth / 2));
    const focusCenterY = focusBounds
      ? ((focusBounds.top + focusBounds.bottom) / 2)
      : (focusEntry ? (focusEntry.y + focusEntry.nodeHeight / 2) : (tree.y + tree.nodeHeight / 2));
    const scheduleScrollSync = typeof window?.setTimeout === "function"
      ? window.setTimeout.bind(window)
      : (typeof globalThis?.setTimeout === "function" ? globalThis.setTimeout.bind(globalThis) : ((fn) => fn()));
    scheduleScrollSync(() => {
      initializeTaskFlowCanvasViewport({
        scroll,
        canvas,
        svg,
        focusCenterX,
        focusCenterY,
        focusTopY: focusBounds?.top ?? (focusEntry ? focusEntry.y : tree.y),
        contentWidth: canvasWidth,
        contentHeight: canvasHeight,
        metrics,
      });
    }, 0);

    if (entries.length <= 1) {
      const emptyState = document.createElement("div");
      emptyState.className = "task-map-empty";
      const emptyLabel = translate("taskMap.empty");
      emptyState.textContent = emptyLabel && emptyLabel !== "taskMap.empty"
        ? emptyLabel
        : "暂无支线，后续任务流程会显示在这里。";
      board.appendChild(emptyState);
    }

    return board;
  }

  function renderProjectedTaskList(state, projection, activeQuest) {
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
      trackerTaskListEl.hidden = true;
      lastTaskMindmapRenderKey = "";
      return;
    }

    syncProjectedTaskMapExpansionState(activeQuest);
    const renderKey = getProjectedTaskMapRenderKey(state, activeQuest);
    if (
      !trackerTaskListEl.hidden
      && trackerTaskListEl.children.length > 0
      && renderKey === lastTaskMindmapRenderKey
    ) {
      return;
    }
    lastTaskMindmapRenderKey = renderKey;
    trackerTaskListEl.innerHTML = "";

    if (!rootNode) {
      const emptyState = document.createElement("div");
      emptyState.className = "task-map-empty";
      emptyState.textContent = "暂无任务地图。";
      trackerTaskListEl.appendChild(emptyState);
      trackerTaskListEl.hidden = false;
      return;
    }

    trackerTaskListEl.appendChild(renderProjectedTaskFlowBoard({
      activeQuest,
      nodeMap,
      rootNode,
      state,
    }));
    trackerTaskListEl.hidden = trackerTaskListEl.children.length === 0;
  }

  function initializeTaskFlowCanvasViewport({
    scroll,
    canvas,
    svg = null,
    focusCenterX = 0,
    focusCenterY = 0,
    focusTopY = 0,
    contentWidth = 0,
    contentHeight = 0,
    metrics = null,
  }) {
    if (!scroll || !canvas) return;
    const viewportWidth = Number(scroll?.clientWidth || scroll?.offsetWidth || 0);
    const viewportHeight = Number(scroll?.clientHeight || scroll?.offsetHeight || 0);
    if (viewportWidth <= 0 || viewportHeight <= 0) return;

    const overscanX = Number(metrics?.overscanX || 0);
    const overscanY = Number(metrics?.overscanY || 0);
    const nextCanvasWidth = Math.max(
      Number(contentWidth || canvas?.offsetWidth || canvas?.scrollWidth || 0),
      viewportWidth + overscanX,
    );
    const nextCanvasHeight = Math.max(
      Number(contentHeight || canvas?.offsetHeight || canvas?.scrollHeight || 0),
      viewportHeight + overscanY,
    );
    if (nextCanvasWidth <= 0 || nextCanvasHeight <= 0) return;

    canvas.style.width = `${Math.ceil(nextCanvasWidth)}px`;
    canvas.style.height = `${Math.ceil(nextCanvasHeight)}px`;
    if (svg && typeof svg.setAttribute === "function") {
      svg.setAttribute("viewBox", `0 0 ${Math.ceil(nextCanvasWidth)} ${Math.ceil(nextCanvasHeight)}`);
      svg.setAttribute("width", String(Math.ceil(nextCanvasWidth)));
      svg.setAttribute("height", String(Math.ceil(nextCanvasHeight)));
    }

    const targetX = clampNumber(
      (viewportWidth / 2) - focusCenterX,
      Math.min(0, viewportWidth - nextCanvasWidth),
      0,
    );
    const targetY = clampNumber(
      Math.min(metrics?.paddingY || 0, viewportHeight * 0.18) - focusTopY,
      Math.min(0, viewportHeight - nextCanvasHeight),
      0,
    );

    const PanzoomFactory = typeof window !== "undefined" ? window.Panzoom : null;
    if (typeof PanzoomFactory === "function") {
      try {
        if (scroll._taskFlowPanzoom && typeof scroll._taskFlowPanzoom.destroy === "function") {
          scroll._taskFlowPanzoom.destroy();
        }
        const panzoom = PanzoomFactory(canvas, {
          canvas: true,
          noBind: true,
          disableZoom: true,
          animate: false,
          cursor: "grab",
          excludeClass: "panzoom-exclude",
          overflow: "hidden",
          touchAction: "none",
          startX: targetX,
          startY: targetY,
        });
        scroll._taskFlowPanzoom = panzoom;
        bindTaskFlowCanvasInteractions(scroll);
        scroll.classList.add("is-panzoom-ready");
        panzoom.pan(targetX, targetY, { force: true });
        return;
      } catch (error) {
        console.warn("[quest] Failed to initialize task flow panzoom:", error?.message || error);
      }
    }

    scroll.classList.remove("is-panzoom-ready");
    scroll.scrollLeft = Math.max(0, focusCenterX - (viewportWidth / 2));
    scroll.scrollTop = Math.max(0, focusCenterY - Math.min(viewportHeight * 0.42, viewportHeight / 2));
  }

  function bindTaskFlowCanvasInteractions(scroll) {
    if (!scroll || scroll.dataset.taskFlowInteractionsBound === "true") return;
    scroll.dataset.taskFlowInteractionsBound = "true";

    let dragState = null;
    let startX = 0;
    let startY = 0;
    let startPanX = 0;
    let startPanY = 0;
    let suppressClickUntil = 0;

    const reset = () => {
      dragState = null;
      scroll.classList.remove("is-pointer-down", "is-dragging");
    };

    const canStartPan = (target) => {
      if (!(target instanceof Element)) return true;
      if (target.closest(".panzoom-exclude")) return false;
      return true;
    };

    const readPan = () => {
      const panzoom = scroll._taskFlowPanzoom;
      if (panzoom && typeof panzoom.getPan === "function") {
        return panzoom.getPan();
      }
      return {
        x: -Number(scroll.scrollLeft || 0),
        y: -Number(scroll.scrollTop || 0),
      };
    };

    const applyPan = (x, y) => {
      const panzoom = scroll._taskFlowPanzoom;
      if (panzoom && typeof panzoom.pan === "function") {
        panzoom.pan(x, y, { force: true });
        return;
      }
      scroll.scrollLeft = Math.max(0, -x);
      scroll.scrollTop = Math.max(0, -y);
    };

    const startDrag = (clientX, clientY, target) => {
      if (!canStartPan(target)) return false;
      startX = clientX;
      startY = clientY;
      const currentPan = readPan();
      startPanX = Number(currentPan?.x || 0);
      startPanY = Number(currentPan?.y || 0);
      dragState = { dragging: false };
      scroll.classList.add("is-pointer-down");
      return true;
    };

    const updateDrag = (clientX, clientY, event) => {
      if (!dragState) return;
      const deltaX = clientX - startX;
      const deltaY = clientY - startY;
      if (!dragState.dragging && Math.hypot(deltaX, deltaY) >= 6) {
        dragState.dragging = true;
        scroll.classList.add("is-dragging");
      }
      if (!dragState.dragging) return;
      event.preventDefault?.();
      applyPan(startPanX + deltaX, startPanY + deltaY);
    };

    const finishDrag = () => {
      if (!dragState) return;
      const didDrag = dragState.dragging === true;
      reset();
      if (didDrag) {
        suppressClickUntil = Date.now() + 180;
      }
    };

    scroll.addEventListener("dragstart", (event) => {
      event.preventDefault();
    });

    scroll.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      startDrag(event.clientX, event.clientY, event.target);
    });

    document.addEventListener("mousemove", (event) => {
      updateDrag(event.clientX, event.clientY, event);
    });

    document.addEventListener("mouseup", () => {
      finishDrag();
    });

    scroll.addEventListener("touchstart", (event) => {
      if (!event.touches || event.touches.length !== 1) return;
      const touch = event.touches[0];
      startDrag(touch.clientX, touch.clientY, event.target);
    }, { passive: true });

    scroll.addEventListener("touchmove", (event) => {
      if (!event.touches || event.touches.length !== 1) return;
      const touch = event.touches[0];
      updateDrag(touch.clientX, touch.clientY, event);
    }, { passive: false });

    scroll.addEventListener("touchend", () => {
      finishDrag();
    }, { passive: true });

    scroll.addEventListener("touchcancel", () => {
      finishDrag();
    }, { passive: true });

    scroll.addEventListener("click", (event) => {
      if (Date.now() <= suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  function renderTaskList(state) {
    if (!trackerTaskListEl) return;
    const projection = getTaskMapProjection();
    const activeQuest = projection?.activeMainQuest || null;
    if (activeQuest) {
      renderProjectedTaskList(state, projection, activeQuest);
      return;
    }
    trackerTaskListEl.classList.remove("is-flow-board");
    const desktopTaskMap = !isMobileQuestTracker();
    const activeBranchId = getTaskMindmapActiveBranchId(state);
    const treeState = getTaskMindmapTreeState(state?.cluster, activeBranchId);
    const hasVisibleBranches = treeState.branchSessions.length > 0;
    const shouldMount = Boolean(
      state?.hasSession
      && (desktopTaskMap || hasVisibleBranches)
    );
    if (taskMapRail) taskMapRail.hidden = !shouldMount;
    syncTaskMapDrawerUi(shouldMount);
    if (!shouldMount) {
      trackerTaskListEl.hidden = true;
      lastTaskMindmapRenderKey = "";
      return;
    }

    const canRenderStableTree = !state?.cluster?._isLocalFallback;
    syncTaskMindmapNodeExpansionState(treeState);
    const renderKey = getTaskMindmapRenderKey(state, treeState);
    if (
      canRenderStableTree
      && !trackerTaskListEl.hidden
      && trackerTaskListEl.children.length > 0
      && renderKey === lastTaskMindmapRenderKey
    ) {
      return;
    }
    lastTaskMindmapRenderKey = canRenderStableTree ? renderKey : "";
    trackerTaskListEl.innerHTML = "";

    const rootSessionId = String(state?.cluster?.mainSessionId || state?.parentSessionId || "").trim();
    const rootCard = createTaskListItem({
      title: state.mainGoal || getClusterTitle(state?.cluster),
      details: [{
        text: getTaskMindmapRootSummary(state),
        className: "quest-task-item-summary",
        max: 112,
      }],
      meta: state.isBranch ? "主任务" : "当前主任务",
      current: !state.isBranch,
      status: "main",
      extraClassName: "quest-task-mindmap-root",
      onClick: state.isBranch && rootSessionId ? () => {
        if (typeof attachSession === "function") {
          setTaskMapDrawerExpanded(false, { render: false });
          attachSession(rootSessionId, state.parentSession || state?.cluster?.mainSession || null);
        }
      } : null,
    });
    trackerTaskListEl.appendChild(rootCard);

    if (!hasVisibleBranches) {
      const emptyState = document.createElement("div");
      emptyState.className = "task-map-empty";
      const emptyLabel = translate("taskMap.empty");
      emptyState.textContent = emptyLabel && emptyLabel !== "taskMap.empty"
        ? emptyLabel
        : "暂无支线，后续任务流程会显示在这里。";
      trackerTaskListEl.appendChild(emptyState);
      trackerTaskListEl.hidden = false;
      return;
    }

    if (!canRenderStableTree) {
      trackerTaskListEl.hidden = false;
      return;
    }

    const directory = document.createElement("div");
    directory.className = "quest-task-directory";

    const createDirectoryBranch = (branchSession, depth = 1) => {
      const branchItem = document.createElement("div");
      branchItem.className = `quest-task-directory-item depth-${Math.min(depth, 6)}`;
      const children = treeState.childrenByParent.get(branchSession.id) || [];
      const hasChildren = children.length > 0;
      const isExpanded = isTaskMindmapNodeExpanded(branchSession.id, treeState.currentLineageIds, hasChildren);
      const branchStatus = String(branchSession?._branchStatus || "active").toLowerCase();
      const isCurrentBranch = branchSession.id === activeBranchId;
      const isCurrentChain = treeState.currentLineageIds.has(branchSession.id);
      const details = [];
      const parentId = typeof branchSession?._branchParentSessionId === "string"
        ? branchSession._branchParentSessionId.trim()
        : "";
      const parentBranch = parentId ? (treeState.branchById.get(parentId) || null) : null;
      if (parentBranch) {
        details.push({
          text: `上级：${getBranchDisplayName(parentBranch)}`,
          className: "quest-task-item-parent",
          max: 72,
        });
      }
      const summary = getBranchRowSummary(branchSession);
      if (summary) {
        details.push({
          text: summary,
          className: "quest-task-item-summary",
          max: 88,
        });
      }

      const row = createTaskListItem({
        title: getBranchDisplayName(branchSession),
        details,
        meta: isCurrentBranch
          ? "当前位置"
          : (isCurrentChain ? "当前路径" : (hasChildren ? `子任务 ${children.length}` : getBranchStatusUi(branchStatus).label)),
        current: isCurrentBranch,
        status: branchStatus,
        extraClassName: "quest-task-directory-row",
        expander: hasChildren ? {
          expanded: isExpanded,
          onToggle: () => toggleTaskMindmapNode(branchSession.id, !isExpanded),
        } : null,
        onClick: () => {
          if (typeof attachSession === "function") {
            setTaskMapDrawerExpanded(false, { render: false });
            attachSession(branchSession.id, branchSession);
          }
        },
      });
      if (hasChildren) branchItem.classList.add("has-children");
      if (isExpanded) branchItem.classList.add("is-expanded");
      if (isCurrentChain) row.classList.add("is-current-chain");
      if (isCurrentBranch) row.classList.add("is-current-branch");
      if (isCurrentChain) branchItem.classList.add("is-current-chain");
      if (isCurrentBranch) branchItem.classList.add("is-current-branch");
      branchItem.appendChild(row);

      if (hasChildren && isExpanded) {
        const childrenWrap = document.createElement("div");
        childrenWrap.className = "quest-task-directory-children";
        for (const childBranch of children) {
          childrenWrap.appendChild(createDirectoryBranch(childBranch, depth + 1));
        }
        branchItem.appendChild(childrenWrap);
      }

      return branchItem;
    };

    for (const branchSession of treeState.childrenByParent.get(rootSessionId) || []) {
      directory.appendChild(createDirectoryBranch(branchSession, 1));
    }

    trackerTaskListEl.appendChild(directory);
    trackerTaskListEl.hidden = trackerTaskListEl.children.length === 0;
  }

  function getBranchStatusUi(branchStatus) {
    switch (String(branchStatus || "").toLowerCase()) {
      case "resolved":
        return { label: "已关闭", summary: "当前子任务已直接关闭，可稍后重新打开。" };
      case "parked":
        return { label: "已挂起", summary: "当前子任务已挂起，并已回到主线。" };
      case "merged":
        return { label: "已带回主线", summary: "当前子任务已收尾并带回主线。" };
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
    const focusedSession = getFocusedSessionRecord();
    const liveSession = focusedSession?.id
      ? (getSessionRecord(focusedSession.id) || focusedSession)
      : null;
    if (!liveSession?.id) {
      return { hasSession: false };
    }
    const liveSessionId = normalizeSessionId(liveSession.id);
    const taskCard = getTaskCard(liveSession);
    const activeContext = getActiveSessionContext(liveSession.id);
    const latestContext = getLatestSessionContext(liveSession.id);
    const cluster = getClusterForSession(liveSession.id);
    const resolvedCurrentBranchSessionId = getResolvedClusterCurrentBranchSessionId(cluster, liveSessionId);
    const clusterMainSession = cluster?.mainSessionId ? (getSessionRecord(cluster.mainSessionId) || cluster?.mainSession || null) : null;
    const clusterBranchSession = Array.isArray(cluster?.branchSessions)
      ? cluster.branchSessions.find((entry) => entry?.id === resolvedCurrentBranchSessionId)
      : null;
    const fallbackIsBranch = Boolean(cluster && cluster.mainSessionId && cluster.mainSessionId !== liveSessionId);
    const isBranch = String(
      activeContext?.lineRole
      || latestContext?.lineRole
      || taskCard?.lineRole
      || (fallbackIsBranch ? "branch" : "main"),
    ).toLowerCase() === "branch";
    const branchStatus = String(
      latestContext?.status
      || clusterBranchSession?._branchStatus
      || (isBranch ? "active" : ""),
    ).toLowerCase();
    const mainGoal = normalizeTitle(
      activeContext?.mainGoal
      || latestContext?.mainGoal
      || taskCard?.mainGoal
      || cluster?.mainGoal
      || clusterMainSession?.taskCard?.mainGoal
      || clusterMainSession?.taskCard?.goal
      || taskCard?.goal
      || liveSession.name
      || "当前主线",
    );
    const mainSummary = toTaskBarSummary(
      activeContext?.summary
      || latestContext?.summary
      || taskCard?.summary
      || cluster?.mainSession?.taskCard?.summary
      || clusterMainSession?.taskCard?.summary
      || "",
      10,
    );
    const currentGoal = normalizeTitle(
      activeContext?.goal
      || latestContext?.goal
      || taskCard?.goal
      || clusterBranchSession?.taskCard?.goal
      || clusterBranchSession?.name
      || liveSession.name
      || mainGoal,
    );
    const rawNextStep = clipText(
      activeContext?.nextStep
      || (getTaskCardList(taskCard, "nextSteps")[0] || "")
      || (getTaskCardList(clusterBranchSession?.taskCard, "nextSteps")[0] || "")
      || activeContext?.resumeHint
      || activeContext?.checkpointSummary
      || "继续把当前目标再推进一步。",
      120,
    );
    const nextStep = shouldHideTrackerNext(rawNextStep) ? "" : rawNextStep;
    const branchFrom = normalizeTitle(activeContext?.branchFrom || taskCard?.branchFrom || mainGoal);
    const parentSessionId = String(
      activeContext?.parentSessionId
      || latestContext?.parentSessionId
      || clusterBranchSession?._branchParentSessionId
      || (fallbackIsBranch ? cluster?.mainSessionId : "")
      || "",
    ).trim();
    const parentSession = parentSessionId
      ? (getSessionRecord(parentSessionId) || clusterMainSession)
      : null;
    const hasBranches = Boolean(cluster && Array.isArray(cluster.branchSessionIds) && cluster.branchSessionIds.length > 0);
    const currentBranchLineage = resolvedCurrentBranchSessionId
      ? getBranchLineageForSession(resolvedCurrentBranchSessionId, cluster)
      : [];
    const activeBranchChain = currentBranchLineage.length > 1
      ? currentBranchLineage.slice(1).join(" / ")
      : "";
    const branchLineage = isBranch
      ? getBranchLineageForSession(liveSessionId, cluster)
      : currentBranchLineage;
    const totalBranchCount = Array.isArray(cluster?.branchSessions) ? cluster.branchSessions.length : 0;
    const branchNames = summarizeBranchNames(cluster?.branchSessions || [], resolvedCurrentBranchSessionId || liveSessionId);
    const hiddenBranchCount = Math.max(0, totalBranchCount - branchNames.length);
    const mainOverview = branchNames.length > 0
      ? `主线：${mainGoal} · 支线：${branchNames.join("、")}${hiddenBranchCount > 0 ? ` 等 ${totalBranchCount} 条` : ""}`
      : `主线：${mainGoal}`;
    return {
      hasSession: true,
      session: liveSession,
      focusedSessionId: liveSessionId,
      taskCard,
      activeContext,
      latestContext,
      isBranch,
      branchStatus,
      mainSummary,
      mainGoal,
      currentGoal,
      nextStep,
      branchFrom,
      parentSessionId,
      parentSession,
      cluster,
      resolvedCurrentBranchSessionId,
      hasBranches,
      branchLineage,
      activeBranchChain,
      totalBranchCount,
      branchNames,
      mainOverview,
    };
  }

  function getEmptyStateNode() {
    if (typeof emptyState !== "undefined" && emptyState) return emptyState;
    return document.getElementById("emptyState");
  }

  function syncQuestEmptyState(state) {
    const emptyNode = getEmptyStateNode();
    if (!emptyNode) return;
    const titleEl = emptyNode.querySelector("h2");
    let bodyEl = emptyNode.querySelector("p");
    if (!bodyEl) {
      bodyEl = document.createElement("p");
      bodyEl.hidden = true;
      emptyNode.appendChild(bodyEl);
    }
    if (titleEl && !titleEl.dataset.defaultText) {
      titleEl.dataset.defaultText = titleEl.textContent || "";
    }
    if (bodyEl && !bodyEl.dataset.defaultText) {
      bodyEl.dataset.defaultText = bodyEl.textContent || "";
    }

    if (!state?.hasSession) {
      emptyNode.classList.remove("quest-empty-state");
      emptyNode.hidden = true;
      if (titleEl) {
        titleEl.hidden = false;
        titleEl.textContent = titleEl.dataset.defaultText || "";
      }
      if (bodyEl) {
        bodyEl.textContent = bodyEl.dataset.defaultText || "";
        bodyEl.hidden = !bodyEl.textContent.trim();
      }
      return;
    }

    emptyNode.hidden = false;
    emptyNode.classList.add("quest-empty-state");
    if (titleEl) {
      titleEl.hidden = true;
      titleEl.textContent = state.isBranch ? "继续当前子任务" : "继续当前任务";
    }
    if (bodyEl) {
      bodyEl.hidden = false;
      bodyEl.textContent = state.isBranch
        ? "直接从输入框继续；需要返回时再用上方任务列表回主线。"
        : "直接从输入框继续，任务列表已经放在上方。";
    }
  }

  function renderTracker() {
    const state = deriveQuestState();
    if (!state.hasSession) {
      closeFinishPanel();
      tracker.hidden = true;
      if (taskMapRail) taskMapRail.hidden = true;
      if (trackerTaskListEl) trackerTaskListEl.hidden = true;
      syncTaskMapDrawerUi(false);
      syncQuestEmptyState(state);
      return;
    }

    tracker.hidden = false;
    syncQuestEmptyState(state);
    const showBranch = Boolean(state.isBranch && state.currentGoal);
    tracker.classList.toggle("is-branch-focus", showBranch);
    const branchStatus = String(state.branchStatus || "").toLowerCase();
    const visibleBranchEntries = getVisibleBranchEntries(state);
    renderTrackerStatus(state);
    const trackerTitle = getTrackerPrimaryTitle(state);
    const trackerPrimaryDetail = getTrackerPrimaryDetail(state);
    const trackerSecondaryDetail = getTrackerSecondaryDetail(state, trackerPrimaryDetail);
    trackerTitleEl.textContent = trackerTitle;
    trackerTitleEl.hidden = false;
    if (trackerBranchEl) {
      trackerBranchEl.hidden = !trackerPrimaryDetail;
      trackerBranchLabelEl.textContent = "任务详情";
      trackerBranchTitleEl.textContent = trackerPrimaryDetail;
    }
    trackerNextEl.hidden = !trackerSecondaryDetail;
    trackerNextEl.textContent = trackerSecondaryDetail;
    if (trackerToggleBtn) {
      trackerToggleBtn.hidden = true;
    }
    trackerActionsEl?.classList.toggle("is-inline-links", Boolean(
      showBranch && (branchStatus === "active" || ["resolved", "merged", "parked"].includes(branchStatus))
    ));
    if (trackerCloseBtn) {
      trackerCloseBtn.hidden = true;
      trackerCloseBtn.textContent = "";
      trackerCloseBtn.title = "";
      trackerCloseBtn.removeAttribute("aria-label");
    }
    if (trackerAltBtn) {
      trackerAltBtn.hidden = true;
      trackerAltBtn.textContent = "";
      trackerAltBtn.title = "";
      trackerAltBtn.removeAttribute("aria-label");
    }
    trackerBackBtn.hidden = !state.isBranch || !state.parentSessionId;
    if (showBranch && branchStatus === "active") {
      if (trackerCloseBtn) {
        trackerCloseBtn.hidden = false;
        trackerCloseBtn.textContent = finishPanelOpen ? "取消收束" : "收束支线";
        trackerCloseBtn.setAttribute("aria-label", trackerCloseBtn.textContent);
        trackerCloseBtn.title = trackerCloseBtn.textContent;
      }
      if (trackerAltBtn) {
        trackerAltBtn.hidden = false;
        trackerAltBtn.textContent = "挂起";
        trackerAltBtn.setAttribute("aria-label", trackerAltBtn.textContent);
        trackerAltBtn.title = trackerAltBtn.textContent;
      }
      trackerBackBtn.hidden = true;
    } else if (showBranch && ["resolved", "merged", "parked"].includes(branchStatus)) {
      closeFinishPanel();
      if (trackerAltBtn) {
        trackerAltBtn.hidden = !state.parentSessionId;
        trackerAltBtn.textContent = "返回主线";
        trackerAltBtn.setAttribute("aria-label", trackerAltBtn.textContent);
        trackerAltBtn.title = trackerAltBtn.textContent;
      }
      trackerBackBtn.textContent = "继续处理";
    } else {
      closeFinishPanel();
      trackerBackBtn.textContent = showBranch ? "完成当前任务" : "";
    }
    trackerFooterEl?.classList.toggle("has-actions", Boolean(
      (trackerCloseBtn && !trackerCloseBtn.hidden)
      || (trackerAltBtn && !trackerAltBtn.hidden)
      || (trackerBackBtn && !trackerBackBtn.hidden)
    ));
    if (finishPanel) {
      const canFinishCurrentBranch = showBranch && branchStatus === "active";
      finishPanel.hidden = !(canFinishCurrentBranch && finishPanelOpen);
      if (canFinishCurrentBranch && finishPanelOpen) {
        syncFinishSummaryInput(state);
      }
    }
    if (!trackerBackBtn.hidden) {
      trackerBackBtn.setAttribute("aria-label", trackerBackBtn.textContent);
      trackerBackBtn.title = trackerBackBtn.textContent;
    } else {
      trackerBackBtn.removeAttribute("aria-label");
      trackerBackBtn.title = "";
    }
    renderTaskList(state);
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
      if (typeof renderSessionList === "function") {
        renderSessionList();
      }
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
      if (typeof renderSessionList === "function") {
        renderSessionList();
      }
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
      setTaskMapDrawerExpanded(false, { render: false });
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

  async function returnToMainline(payload = {}) {
    const state = deriveQuestState();
    if (!state.hasSession || !state.isBranch || !state.session?.id) return null;
    const response = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(state.session.id)}/merge-return`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    snapshot = response?.snapshot || snapshot;
    rememberFinishSummaryDraft(state.session.id, "");
    if (typeof fetchSessionsList === "function") {
      await fetchSessionsList();
    }
    if (response?.session && typeof attachSession === "function") {
      setTaskMapDrawerExpanded(false, { render: false });
      attachSession(response.session.id, response.session);
    }
    renderTracker();
    renderPathPanel();
    return response?.session || null;
  }

  async function mergeCurrentBranchSummaryAndReturnToMainline() {
    const state = deriveQuestState();
    if (!state.hasSession || !state.isBranch || !state.session?.id) return null;
    const broughtBack = String(finishSummaryInput?.value || "").trim() || resolveFinishSummaryDraft(state);
    rememberFinishSummaryDraft(state.session.id, broughtBack);
    return returnToMainline({
      mergeType: "conclusion",
      broughtBack,
    });
  }

  async function setCurrentBranchStatus(status, sessionIdOverride = "") {
    const state = deriveQuestState();
    const targetSessionId = sessionIdOverride || state.session?.id || "";
    const isBranchTarget = sessionIdOverride ? true : state.isBranch;
    if (!targetSessionId || !isBranchTarget) return null;
    const response = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(targetSessionId)}/branch-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    snapshot = response?.snapshot || snapshot;
    if (response?.session) {
      replaceSessionRecord(response.session);
    }
    if (typeof fetchSessionsList === "function") {
      await fetchSessionsList();
    }
    renderTracker();
    renderPathPanel();
    return response?.session || null;
  }

  async function reopenCurrentBranch() {
    return setCurrentBranchStatus("active");
  }

  async function parkAndReturnToMainline() {
    const state = deriveQuestState();
    if (!state.hasSession || !state.isBranch) return null;
    rememberFinishSummaryDraft(state.session?.id, finishSummaryInput?.value || "");
    await setCurrentBranchStatus("parked");
    return returnToParentSession();
  }

  async function resolveAndReturnToMainline() {
    const state = deriveQuestState();
    if (!state.hasSession || !state.isBranch) return null;
    rememberFinishSummaryDraft(state.session?.id, "");
    await setCurrentBranchStatus("resolved");
    return returnToParentSession();
  }

  function returnToParentSession() {
    const state = deriveQuestState();
    if (!state.parentSessionId || typeof attachSession !== "function") return null;
    setTaskMapDrawerExpanded(false, { render: false });
    attachSession(state.parentSessionId, state.parentSession || null);
    renderTracker();
    return state.parentSessionId;
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

  trackerBackBtn?.addEventListener("click", () => {
    const state = deriveQuestState();
    const branchStatus = String(state.branchStatus || "").toLowerCase();
    if (branchStatus === "active") {
      openFinishPanel(state);
      return;
    }
    void reopenCurrentBranch();
  });

  trackerAltBtn?.addEventListener("click", () => {
    const state = deriveQuestState();
    const branchStatus = String(state.branchStatus || "").toLowerCase();
    if (branchStatus === "active") {
      void parkAndReturnToMainline();
      return;
    }
    returnToParentSession();
  });

  trackerCloseBtn?.addEventListener("click", () => {
    const state = deriveQuestState();
    const branchStatus = String(state.branchStatus || "").toLowerCase();
    if (branchStatus === "active") {
      if (finishPanelOpen) {
        closeFinishPanel();
      } else {
        openFinishPanel(state);
      }
    }
  });

  finishSummaryInput?.addEventListener("input", () => {
    rememberFinishSummaryDraft(getFocusedSessionId(), finishSummaryInput.value);
  });

  finishResolveBtn?.addEventListener("click", async () => {
    closeFinishPanel();
    await resolveAndReturnToMainline();
  });

  finishParkBtn?.addEventListener("click", async () => {
    closeFinishPanel();
    await parkAndReturnToMainline();
  });

  finishMergeBtn?.addEventListener("click", async () => {
    closeFinishPanel();
    await mergeCurrentBranchSummaryAndReturnToMainline();
  });

  document.addEventListener("melodysync:session-change", (event) => {
    const previousFocusedSessionId = getFocusedSessionId();
    const nextFocusedSessionId = normalizeSessionId(event?.detail?.session?.id || "");
    closeFinishPanel({ sessionId: previousFocusedSessionId });
    setTaskMapDrawerExpanded(false, { render: false });
    if (nextFocusedSessionId) {
      setFocusedSessionId(nextFocusedSessionId, { render: false });
    }
    lastTaskMindmapRenderKey = "";
    renderTracker();
    void refreshTrackerSnapshot(nextFocusedSessionId);
    scheduleFullSnapshotRefresh(1400);
  });

  window.addEventListener("focus", () => {
    void refreshTrackerSnapshot();
    scheduleFullSnapshotRefresh(1800);
  });

  window.addEventListener("resize", () => {
    lastTaskMindmapRenderKey = "";
    if (!isMobileQuestTracker()) {
      branchStructureExpanded = false;
    }
    renderTracker();
  });

  window.addEventListener("melodysync:status-change", () => {
    renderTracker();
  });

  trackerToggleBtn?.addEventListener("click", () => {
    setTaskMapDrawerExpanded(!isMobileTaskMapDrawerOpen());
  });

  taskMapDrawerBtn?.addEventListener("click", () => {
    setTaskMapDrawerExpanded(!isMobileTaskMapDrawerOpen());
  });

  taskMapDrawerBackdrop?.addEventListener("click", () => {
    setTaskMapDrawerExpanded(false);
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
    returnToMainline,
    parkAndReturnToMainline,
    resolveAndReturnToMainline,
    reopenCurrentBranch,
    mergeCurrentBranchSummaryAndReturnToMainline,
    setCurrentBranchStatus,
    openTaskMapDrawer: () => setTaskMapDrawerExpanded(true),
    closeTaskMapDrawer: () => setTaskMapDrawerExpanded(false),
    toggleTaskMapDrawer: () => setTaskMapDrawerExpanded(!isMobileTaskMapDrawerOpen()),
    isTaskMapDrawerOpen: isMobileTaskMapDrawerOpen,
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
