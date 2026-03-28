(function workbenchModule() {
  const tracker = document.getElementById("questTracker");
  const trackerLabelEl = document.getElementById("questTrackerLabel");
  const trackerTitleEl = document.getElementById("questTrackerTitle");
  const trackerBranchEl = document.getElementById("questTrackerBranch");
  const trackerBranchLabelEl = document.getElementById("questTrackerBranchLabel");
  const trackerBranchTitleEl = document.getElementById("questTrackerBranchTitle");
  const trackerNextEl = document.getElementById("questTrackerNext");
  const trackerTaskListEl = document.getElementById("questTaskList");
  const trackerActionsEl = document.getElementById("questTrackerActions");
  const trackerToggleBtn = document.getElementById("questTrackerToggleBtn");
  const trackerCloseBtn = document.getElementById("questTrackerCloseBtn");
  const trackerAltBtn = document.getElementById("questTrackerAltBtn");
  const trackerBackBtn = document.getElementById("questTrackerBackBtn");
  const finishPanel = document.getElementById("questFinishPanel");
  const finishResolveBtn = document.getElementById("questFinishResolveBtn");
  const finishParkBtn = document.getElementById("questFinishParkBtn");
  const finishMergeBtn = document.getElementById("questFinishMergeBtn");
  if (!tracker) return;

  const SUPPRESSED_PREFIX = "melodysyncSuppressedBranch";

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
  let branchStructureExpanded = false;
  let taskMindmapNodeExpansionState = new Map();
  let lastTaskMindmapRenderKey = "";

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

  function renderChevronIcon(expanded, className = "") {
    if (typeof renderUiIcon === "function") {
      return renderUiIcon(expanded ? "chevron-down" : "chevron-right", className);
    }
    return expanded ? "▾" : "▸";
  }

  function setTrackerToggleContent(expanded) {
    if (!trackerToggleBtn) return;
    trackerToggleBtn.innerHTML = `
      <span class="quest-tracker-toggle-label">子任务</span>
      <span class="quest-tracker-toggle-icon">${renderChevronIcon(expanded, "quest-tracker-toggle-svg")}</span>
    `;
  }

  function getSessionActivityTimestamp(session) {
    const value = session?.updatedAt || session?.lastEventAt || session?.created || "";
    const stamp = new Date(value).getTime();
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function normalizeTaskClusterKey(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function closeFinishPanel() {
    finishPanelOpen = false;
    if (finishPanel) finishPanel.hidden = true;
  }

  function isMobileQuestTracker() {
    const viewportWidth = Number(window?.innerWidth || 0);
    return viewportWidth > 0 && viewportWidth <= 767;
  }

  function syncFinishPanelVisibility(state) {
    if (!finishPanel) return;
    const shouldShow = Boolean(
      finishPanelOpen
      && state?.isBranch
      && String(state?.branchStatus || "").toLowerCase() === "active"
    );
    finishPanel.hidden = !shouldShow;
  }

  function shouldHideTrackerNext(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return true;
    return [
      /等待用户.*决定/i,
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

  function getClusterKey(cluster) {
    return String(
      cluster?.mainSessionId
      || cluster?.mainGoal
      || cluster?.mainSession?.taskCard?.mainGoal
      || cluster?.mainSession?.taskCard?.goal
      || cluster?.mainSession?.name
      || "",
    ).trim().toLowerCase();
  }

  function getClusterLeadSession(cluster) {
    const currentBranchId = String(cluster?.currentBranchSessionId || "").trim();
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
    const currentBranchId = String(cluster?.currentBranchSessionId || "").trim();
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

  function getClusterTimestamp(cluster) {
    const branchTimes = Array.isArray(cluster?.branchSessions)
      ? cluster.branchSessions.map((entry) => getSessionActivityTimestamp(entry))
      : [];
    const mainTime = getSessionActivityTimestamp(cluster?.mainSession || getClusterLeadSession(cluster));
    return Math.max(mainTime, ...branchTimes, 0);
  }

  function getVisibleTaskClusters(state) {
    const deduped = new Map();
    const addCluster = (cluster) => {
      const key = getClusterKey(cluster);
      if (!key || deduped.has(key)) return;
      deduped.set(key, cluster);
    };
    if (Array.isArray(snapshot.taskClusters)) {
      snapshot.taskClusters.forEach(addCluster);
    }
    if (state?.cluster) addCluster(state.cluster);
    const currentKey = getClusterKey(state?.cluster);
    return [...deduped.values()].sort((left, right) => {
      const leftIsCurrent = getClusterKey(left) === currentKey ? 1 : 0;
      const rightIsCurrent = getClusterKey(right) === currentKey ? 1 : 0;
      return (rightIsCurrent - leftIsCurrent) || (getClusterTimestamp(right) - getClusterTimestamp(left));
    });
  }

  function getCompressedTaskSiblingLimit() {
    const viewportWidth = Number(window?.innerWidth || 0);
    if (viewportWidth > 0 && viewportWidth <= 480) return 1;
    return 2;
  }

  function getCurrentTaskSummary(state) {
    if (!state?.hasSession) return "";
    if (state.isBranch) {
      const sourceGoal = normalizeTitle(state.branchFrom || state.mainGoal || "");
      return sourceGoal ? `来自主线：${sourceGoal}` : "当前正在处理子任务";
    }
    const nextStep = clipText(state.nextStep || "", 88);
    if (nextStep) return nextStep;
    const clusterSummary = getClusterSummary(state.cluster);
    if (clusterSummary) return clusterSummary;
    return "继续推进这项任务";
  }

  function getCurrentTaskMeta(state) {
    if (!state?.hasSession) return "";
    if (state.isBranch) {
      return getBranchStatusUi(state.branchStatus).label;
    }
    return "主线";
  }

  function getSortedBranchSessions(cluster) {
    return [...(Array.isArray(cluster?.branchSessions) ? cluster.branchSessions : [])].sort((left, right) => {
      const leftStatus = String(left?._branchStatus || "").toLowerCase() === "active" ? 1 : 0;
      const rightStatus = String(right?._branchStatus || "").toLowerCase() === "active" ? 1 : 0;
      return (rightStatus - leftStatus) || (getSessionActivityTimestamp(right) - getSessionActivityTimestamp(left));
    });
  }

  function getStructuredBranchSessions(cluster, currentBranchSessionId = "") {
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

    const statusOrder = { active: 0, parked: 1, resolved: 2, merged: 3 };
    const ordered = [];
    const visited = new Set();
    const sortChildren = (left, right) => {
      const leftCurrent = left?.id === currentBranchSessionId ? 0 : 1;
      const rightCurrent = right?.id === currentBranchSessionId ? 0 : 1;
      if (leftCurrent !== rightCurrent) return leftCurrent - rightCurrent;

      const leftStatus = statusOrder[String(left?._branchStatus || "active").toLowerCase()] ?? 99;
      const rightStatus = statusOrder[String(right?._branchStatus || "active").toLowerCase()] ?? 99;
      if (leftStatus !== rightStatus) return leftStatus - rightStatus;

      return getSessionActivityTimestamp(right) - getSessionActivityTimestamp(left);
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
      String(state?.cluster?.currentBranchSessionId || state?.session?.id || "").trim(),
    );
  }

  function getTaskMindmapActiveBranchId(state) {
    return String(
      state?.cluster?.currentBranchSessionId
      || (state?.isBranch ? state?.session?.id : "")
      || "",
    ).trim();
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

    const statusOrder = { active: 0, parked: 1, resolved: 2, merged: 3 };
    const compareBranches = (left, right) => {
      const leftInLineage = currentLineageIds.has(left?.id) ? 0 : 1;
      const rightInLineage = currentLineageIds.has(right?.id) ? 0 : 1;
      if (leftInLineage !== rightInLineage) return leftInLineage - rightInLineage;

      const leftCurrent = left?.id === currentBranchSessionId ? 0 : 1;
      const rightCurrent = right?.id === currentBranchSessionId ? 0 : 1;
      if (leftCurrent !== rightCurrent) return leftCurrent - rightCurrent;

      const leftStatus = statusOrder[String(left?._branchStatus || "active").toLowerCase()] ?? 99;
      const rightStatus = statusOrder[String(right?._branchStatus || "active").toLowerCase()] ?? 99;
      if (leftStatus !== rightStatus) return leftStatus - rightStatus;

      return getSessionActivityTimestamp(right) - getSessionActivityTimestamp(left);
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
    if (activePath) return `当前路径：${activePath}`;
    const nextStep = clipText(state?.nextStep || "", 88);
    if (nextStep) return nextStep;
    const branchNames = Array.isArray(state?.branchNames)
      ? state.branchNames.filter((entry) => typeof entry === "string" && entry.trim())
      : [];
    if (branchNames.length > 0) {
      return `支线：${branchNames.slice(0, 3).join("、")}`;
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

  function createTaskListItem({
    title,
    details = [],
    meta = "",
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

  function renderTaskList(state) {
    if (!trackerTaskListEl) return;
    const activeBranchId = getTaskMindmapActiveBranchId(state);
    const treeState = getTaskMindmapTreeState(state?.cluster, activeBranchId);
    const hasVisibleBranches = treeState.branchSessions.length > 0;
    const shouldShow = Boolean(
      state?.hasSession
      && hasVisibleBranches
      && branchStructureExpanded
    );
    if (!shouldShow) {
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
          attachSession(rootSessionId, state.parentSession || state?.cluster?.mainSession || null);
        }
      } : null,
    });
    trackerTaskListEl.appendChild(rootCard);

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
    const session = getCurrentSessionSafe();
    const liveSession = session?.id ? getSessionRecord(session.id) : null;
    if (!session?.id || !liveSession) {
      return { hasSession: false };
    }
    const taskCard = getTaskCard(liveSession);
    const activeContext = getActiveSessionContext(liveSession.id);
    const latestContext = getLatestSessionContext(liveSession.id);
    const cluster = getClusterForSession(liveSession.id);
    const clusterMainSession = cluster?.mainSessionId ? (getSessionRecord(cluster.mainSessionId) || cluster?.mainSession || null) : null;
    const clusterBranchSession = Array.isArray(cluster?.branchSessions)
      ? cluster.branchSessions.find((entry) => entry?.id === liveSession.id)
      : null;
    const fallbackIsBranch = Boolean(cluster && cluster.mainSessionId && cluster.mainSessionId !== liveSession.id);
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
    const currentBranchLineage = cluster?.currentBranchSessionId
      ? getBranchLineageForSession(cluster.currentBranchSessionId, cluster)
      : [];
    const activeBranchChain = currentBranchLineage.length > 1
      ? currentBranchLineage.slice(1).join(" / ")
      : "";
    const branchLineage = isBranch
      ? getBranchLineageForSession(liveSession.id, cluster)
      : currentBranchLineage;
    const totalBranchCount = Array.isArray(cluster?.branchSessions) ? cluster.branchSessions.length : 0;
    const branchNames = summarizeBranchNames(cluster?.branchSessions || [], liveSession.id);
    const hiddenBranchCount = Math.max(0, totalBranchCount - branchNames.length);
    const mainOverview = branchNames.length > 0
      ? `主线：${mainGoal} · 支线：${branchNames.join("、")}${hiddenBranchCount > 0 ? ` 等 ${totalBranchCount} 条` : ""}`
      : `主线：${mainGoal}`;
    return {
      hasSession: true,
      session: liveSession,
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
      syncQuestEmptyState(state);
      return;
    }

    tracker.hidden = false;
    syncQuestEmptyState(state);
    const showBranch = Boolean(state.isBranch && state.currentGoal);
    const mainTrackerTitle = state.mainSummary || state.mainGoal;
    tracker.classList.toggle("is-branch-focus", showBranch);
    const branchStatus = String(state.branchStatus || "").toLowerCase();
    const branchStatusUi = getBranchStatusUi(branchStatus);
    const visibleBranchEntries = getVisibleBranchEntries(state);
    trackerLabelEl.textContent = showBranch ? "当前子任务" : "当前任务";
    trackerTitleEl.textContent = showBranch
      ? toConciseGoal(state.currentGoal, 52)
      : (mainTrackerTitle || "当前任务");
    trackerTitleEl.hidden = false;
    if (trackerBranchEl) {
      trackerBranchEl.hidden = true;
    }
    trackerNextEl.hidden = !showBranch || !state.nextStep || branchStructureExpanded;
    trackerNextEl.textContent = showBranch ? clipText(state.nextStep, 80) : "";
    if (trackerToggleBtn) {
      const showToggle = visibleBranchEntries.length > 0 && isMobileQuestTracker();
      trackerToggleBtn.hidden = !showToggle;
      if (showToggle) setTrackerToggleContent(branchStructureExpanded);
      trackerToggleBtn.setAttribute("aria-expanded", branchStructureExpanded ? "true" : "false");
      trackerToggleBtn.title = branchStructureExpanded ? "收起子任务" : "展开子任务";
      trackerToggleBtn.setAttribute("aria-label", trackerToggleBtn.title);
    }
    trackerActionsEl?.classList.toggle("is-inline-links", Boolean(
      (trackerToggleBtn && !trackerToggleBtn.hidden)
      || (showBranch && (branchStatus === "active" || ["resolved", "merged", "parked"].includes(branchStatus)))
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
        trackerCloseBtn.textContent = "close";
        trackerCloseBtn.setAttribute("aria-label", trackerCloseBtn.textContent);
        trackerCloseBtn.title = trackerCloseBtn.textContent;
      }
      if (trackerAltBtn) {
        trackerAltBtn.hidden = false;
        trackerAltBtn.textContent = "stop";
        trackerAltBtn.setAttribute("aria-label", trackerAltBtn.textContent);
        trackerAltBtn.title = trackerAltBtn.textContent;
      }
      trackerBackBtn.hidden = true;
      closeFinishPanel();
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
    const targetSessionId = String(sessionIdOverride || session?.id || "").trim();
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

  async function enterBranchFromCurrentSession(branchTitle, options = {}) {
    const session = getCurrentSessionSafe();
    if (!session?.id || !branchTitle) return null;
    clearSuppressed(session.id, branchTitle);
    void persistCandidateSuppression(session.id, branchTitle, false);
    const response = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(session.id)}/branches`, {
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
      attachSession(response.session.id, response.session);
    }
    renderTracker();
    renderPathPanel();
    return response?.session || null;
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

  async function returnToMainline() {
    const state = deriveQuestState();
    if (!state.hasSession || !state.isBranch || !state.session?.id) return null;
    const response = await fetchJsonOrRedirect(`/api/workbench/sessions/${encodeURIComponent(state.session.id)}/merge-return`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    snapshot = response?.snapshot || snapshot;
    if (typeof fetchSessionsList === "function") {
      await fetchSessionsList();
    }
    if (response?.session && typeof attachSession === "function") {
      attachSession(response.session.id, response.session);
    }
    renderTracker();
    renderPathPanel();
    return response?.session || null;
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
    await setCurrentBranchStatus("parked");
    return returnToParentSession();
  }

  async function resolveAndReturnToMainline() {
    const state = deriveQuestState();
    if (!state.hasSession || !state.isBranch) return null;
    await setCurrentBranchStatus("resolved");
    return returnToParentSession();
  }

  function returnToParentSession() {
    const state = deriveQuestState();
    if (!state.parentSessionId || typeof attachSession !== "function") return null;
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
    enterBtn.textContent = "单独展开";
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
      void returnToMainline();
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
      void resolveAndReturnToMainline();
    }
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
    await returnToMainline();
  });

  document.addEventListener("melodysync:session-change", () => {
    branchStructureExpanded = false;
    taskMindmapNodeExpansionState = new Map();
    lastTaskMindmapRenderKey = "";
    closeFinishPanel();
    renderTracker();
    void refreshTrackerSnapshot();
    scheduleFullSnapshotRefresh(1400);
  });

  window.addEventListener("focus", () => {
    void refreshTrackerSnapshot();
    scheduleFullSnapshotRefresh(1800);
  });

  trackerToggleBtn?.addEventListener("click", () => {
    branchStructureExpanded = !branchStructureExpanded;
    renderTracker();
  });

  tracker?.addEventListener("mouseenter", () => {
    const state = deriveQuestState();
    if (isMobileQuestTracker() || getVisibleBranchEntries(state).length <= 0) return;
    branchStructureExpanded = true;
    renderTracker();
  });

  tracker?.addEventListener("mouseleave", () => {
    if (isMobileQuestTracker()) return;
    branchStructureExpanded = false;
    renderTracker();
  });

  window.MelodySyncWorkbench = {
    surfaceMode: "quest_tracker",
    refresh: refreshSnapshot,
    getSnapshot: () => snapshot,
    canOpenManualBranch,
    createBranchSuggestionItem,
    createBranchEnteredCard,
    createMergeNoteCard,
    enterBranchFromCurrentSession,
    openManualBranchFromText,
    returnToMainline,
    parkAndReturnToMainline,
    resolveAndReturnToMainline,
    reopenCurrentBranch,
    setCurrentBranchStatus,
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
