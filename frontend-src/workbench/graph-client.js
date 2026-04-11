(function workbenchGraphClientModule() {
  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeKey(value) {
    return trimText(value).replace(/\s+/g, " ").toLowerCase();
  }

  function getTaskRunStatusApi() {
    return globalThis?.MelodySyncTaskRunStatus || globalThis?.window?.MelodySyncTaskRunStatus || null;
  }

  function normalizeWorkflowState(value) {
    const api = getTaskRunStatusApi();
    if (typeof api?.normalizeWorkflowState === "function") {
      return api.normalizeWorkflowState(value);
    }
    return "";
  }

  function normalizeActivityState(value) {
    const api = getTaskRunStatusApi();
    if (typeof api?.normalizeActivityState === "function") {
      return api.normalizeActivityState(value);
    }
    return "";
  }

  function normalizeStatusToken(value) {
    const api = getTaskRunStatusApi();
    if (typeof api?.normalizeStatusToken === "function") {
      return api.normalizeStatusToken(value);
    }
    return trimText(value).toLowerCase();
  }

  function resolveBranchLikeStatus(...values) {
    const api = getTaskRunStatusApi();
    if (typeof api?.resolveBranchLikeStatus === "function") {
      return api.resolveBranchLikeStatus(...values);
    }
    return "active";
  }

  function getNodeEffectsApi() {
    return globalThis?.MelodySyncWorkbenchNodeEffects
      || globalThis?.window?.MelodySyncWorkbenchNodeEffects
      || null;
  }

  function getSessionStateModelApi() {
    return globalThis?.MelodySyncSessionStateModel
      || globalThis?.window?.MelodySyncSessionStateModel
      || null;
  }

  function isSessionBusy(session = null) {
    const sessionStateModel = getSessionStateModelApi();
    if (typeof sessionStateModel?.isSessionBusy === "function") {
      return sessionStateModel.isSessionBusy(session);
    }
    if (!session || typeof session !== "object") return false;
    if (session?.busy === true) return true;
    return normalizeActivityState(session?.activity?.run?.state || "") === "running"
      || normalizeStatusToken(session?.activity?.queue?.state || "") === "queued"
      || normalizeStatusToken(session?.activity?.compact?.state || "") === "pending";
  }

  function getLatestBranchContext(snapshot = null, sessionId = "") {
    const normalizedSessionId = trimText(sessionId);
    if (!normalizedSessionId) return null;
    let latestEntry = null;
    let latestStamp = -1;
    for (const entry of Array.isArray(snapshot?.branchContexts) ? snapshot.branchContexts : []) {
      if (trimText(entry?.sessionId) !== normalizedSessionId) continue;
      const stamp = Date.parse(entry?.updatedAt || entry?.createdAt || "") || 0;
      if (!latestEntry || stamp >= latestStamp) {
        latestEntry = entry;
        latestStamp = stamp;
      }
    }
    return latestEntry;
  }

  function mergeSessionRecords(primary = null, fallback = null) {
    if (!primary) return fallback || null;
    if (!fallback) return primary || null;
    return {
      ...fallback,
      ...primary,
      busy: primary?.busy === true || fallback?.busy === true,
      workflowState: trimText(primary?.workflowState || "") || trimText(fallback?.workflowState || ""),
      _branchStatus: trimText(primary?._branchStatus || "") || trimText(fallback?._branchStatus || ""),
      branchStatus: trimText(primary?.branchStatus || "") || trimText(fallback?.branchStatus || ""),
      taskCard: primary?.taskCard || fallback?.taskCard || null,
      activity: primary?.activity?.run || fallback?.activity?.run
        ? {
            ...(fallback?.activity && typeof fallback.activity === "object" ? fallback.activity : {}),
            ...(primary?.activity && typeof primary.activity === "object" ? primary.activity : {}),
            run: primary?.activity?.run || fallback?.activity?.run || null,
          }
        : (primary?.activity || fallback?.activity || null),
    };
  }

  function resolveSessionRecord(sessionId = "", { getSessionRecord = () => null, getCurrentSession = () => null } = {}) {
    const normalizedSessionId = trimText(sessionId);
    if (!normalizedSessionId) return null;
    const currentSession = getCurrentSession?.() || null;
    const sessionRecord = getSessionRecord?.(normalizedSessionId) || null;
    if (trimText(currentSession?.id) === normalizedSessionId) {
      return mergeSessionRecords(currentSession, sessionRecord);
    }
    return sessionRecord;
  }

  function normalizeGraphNodeStatuses(
    quest = null,
    {
      snapshot = null,
      getSessionRecord = () => null,
      getCurrentSession = () => null,
    } = {},
  ) {
    const nodes = Array.isArray(quest?.nodes) ? quest.nodes : [];
    for (const node of nodes) {
      const sessionId = trimText(node?.sessionId);
      const session = resolveSessionRecord(sessionId, { getSessionRecord, getCurrentSession });
      const branchContext = getLatestBranchContext(snapshot, sessionId);
      node.workflowState = normalizeWorkflowState(
        node?.workflowState
        || session?.workflowState
        || "",
      );
      node.activity = session?.activity || node?.activity || null;
      node.activityState = normalizeActivityState(
        node?.activityState
        || session?.activity?.run?.state
        || "",
      );
      node.busy = isSessionBusy(session);

      if (normalizeKey(node?.kind) === "branch") {
        node.status = resolveBranchLikeStatus(
          node?.status,
          node?.workflowState,
          session?._branchStatus,
          session?.branchStatus,
          session?.taskCard?.branchStatus,
          branchContext?.status,
          normalizeWorkflowState(session?.workflowState || ""),
        );
        continue;
      }

      if (normalizeKey(node?.kind) === "main") {
        const workflowState = normalizeWorkflowState(node?.workflowState || session?.workflowState || "");
        if (workflowState === "done") {
          node.status = "done";
        } else if (workflowState === "parked") {
          node.status = "parked";
        }
      }
    }

    quest.counts = getNodeEffectsApi()?.buildQuestNodeCounts?.(nodes) || quest.counts || null;
    return quest;
  }

  function cloneJson(value) {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function collectClusterBranchSessionIds(cluster = null) {
    const sessionIds = new Set();
    for (const sessionId of Array.isArray(cluster?.branchSessionIds) ? cluster.branchSessionIds : []) {
      const normalizedSessionId = trimText(sessionId);
      if (normalizedSessionId) sessionIds.add(normalizedSessionId);
    }
    for (const branchSession of Array.isArray(cluster?.branchSessions) ? cluster.branchSessions : []) {
      const normalizedSessionId = trimText(branchSession?.id);
      if (normalizedSessionId) sessionIds.add(normalizedSessionId);
    }
    return sessionIds;
  }

  function resolveTaskMapGraphRootSessionId({
    sessionId = "",
    snapshot = null,
    getSessionRecord = () => null,
    getCurrentSession = () => null,
  } = {}) {
    const normalizedSessionId = trimText(sessionId)
      || trimText(getCurrentSession?.()?.id || "");
    if (!normalizedSessionId) return "";

    const sessionRecord = getSessionRecord?.(normalizedSessionId)
      || (trimText(getCurrentSession?.()?.id || "") === normalizedSessionId ? getCurrentSession?.() : null);

    // 1. Check sessionState.longTerm (projected membership)
    const projectedLongTerm = sessionRecord?.sessionState?.longTerm;
    const projectedLongTermRootSessionId = trimText(projectedLongTerm?.rootSessionId || "");
    const projectedLongTermRole = trimText(projectedLongTerm?.role || "").toLowerCase();
    if (
      projectedLongTermRootSessionId
      && (projectedLongTermRole === "member" || projectedLongTermRole === "project")
    ) {
      return projectedLongTermRootSessionId;
    }

    // 2. Check taskPoolMembership.longTerm (explicit API-set membership)
    const ltMembership = sessionRecord?.taskPoolMembership?.longTerm;
    const ltProjectSessionId = trimText(ltMembership?.projectSessionId || "");
    const ltRole = trimText(ltMembership?.role || "").toLowerCase();
    if (ltProjectSessionId && ltRole !== "project") {
      return ltProjectSessionId;
    }

    const explicitRootSessionId = trimText(sessionRecord?.rootSessionId || "");
    if (explicitRootSessionId) return explicitRootSessionId;

    for (const cluster of Array.isArray(snapshot?.taskClusters) ? snapshot.taskClusters : []) {
      const mainSessionId = trimText(cluster?.mainSessionId || "");
      if (!mainSessionId) continue;
      if (normalizedSessionId === mainSessionId) return mainSessionId;
      if (collectClusterBranchSessionIds(cluster).has(normalizedSessionId)) {
        return mainSessionId;
      }
    }

    return trimText(snapshot?.taskMapGraph?.rootSessionId || normalizedSessionId);
  }

  function canReuseTaskMapGraph(taskMapGraph = null, rootSessionId = "") {
    return trimText(taskMapGraph?.rootSessionId || "") === trimText(rootSessionId || "");
  }

  function resolveFocusedNode(nodes = [], preferredSessionIds = []) {
    const normalizedSessionIds = (Array.isArray(preferredSessionIds) ? preferredSessionIds : [])
      .map((value) => trimText(value))
      .filter(Boolean);
    if (!normalizedSessionIds.length) return null;
    return normalizedSessionIds
      .map((sessionId) => nodes.find((node) => trimText(node?.sessionId) === sessionId))
      .find(Boolean) || null;
  }

  function applyActiveNodeSelection(quest = null, activeNode = null, nodeById = new Map()) {
    if (!quest || !activeNode) return quest;
    const nodes = Array.isArray(quest?.nodes) ? quest.nodes : [];
    for (const node of nodes) {
      node.isCurrent = false;
      node.isCurrentPath = false;
    }

    activeNode.isCurrent = true;
    const currentPathNodeIds = [];
    if (!trimText(activeNode?.parentNodeId || "")) {
      activeNode.isCurrentPath = true;
      currentPathNodeIds.push(activeNode.id);
    } else {
      currentPathNodeIds.push(activeNode.id);
      let cursor = nodeById.get(trimText(activeNode?.parentNodeId || "")) || null;
      while (cursor) {
        if (trimText(cursor?.parentNodeId || "")) {
          cursor.isCurrentPath = true;
          currentPathNodeIds.unshift(cursor.id);
        }
        cursor = nodeById.get(trimText(cursor?.parentNodeId || "")) || null;
      }
    }

    quest.currentNodeId = trimText(activeNode.id);
    quest.currentNodeTitle = trimText(activeNode.title) || trimText(quest?.currentNodeTitle) || "当前任务";
    quest.currentPathNodeIds = currentPathNodeIds;
    return quest;
  }

  function getFetchJson() {
    return globalThis?.fetchJsonOrRedirect
      || globalThis?.window?.fetchJsonOrRedirect
      || null;
  }

  async function fetchTaskMapGraphForSession(sessionId = "") {
    const normalizedSessionId = trimText(sessionId);
    const fetchJson = getFetchJson();
    if (!normalizedSessionId || typeof fetchJson !== "function") return null;
    return fetchJson(`/api/workbench/sessions/${encodeURIComponent(normalizedSessionId)}/task-map-graph`);
  }

  function buildProjectionFromTaskMapGraph(
    taskMapGraph = null,
    {
      currentSessionId = "",
      focusedSessionId = "",
      snapshot = null,
      getSessionRecord = () => null,
      getCurrentSession = () => null,
    } = {},
  ) {
    if (!taskMapGraph || typeof taskMapGraph !== "object") return null;
    const quest = cloneJson(taskMapGraph);
    const nodes = Array.isArray(quest?.nodes) ? quest.nodes : [];
    const edges = Array.isArray(quest?.edges) ? quest.edges : [];
    if (!trimText(quest?.rootSessionId) || nodes.length === 0) return null;
    normalizeGraphNodeStatuses(quest, { snapshot, getSessionRecord, getCurrentSession });
    const nodeById = new Map(nodes.filter((node) => trimText(node?.id)).map((node) => [trimText(node.id), node]));
    const focusedNode = resolveFocusedNode(nodes, [focusedSessionId, currentSessionId]);
    const activeNode = focusedNode
      || nodeById.get(trimText(quest?.currentNodeId))
      || nodes.find((node) => node?.isCurrent)
      || nodes[0]
      || null;
    applyActiveNodeSelection(quest, activeNode, nodeById);
    quest.nodeIds = nodes.map((node) => node.id);
    quest.edgeIds = edges.map((edge) => edge.id);
    return {
      mainQuests: [quest],
      activeMainQuestId: trimText(quest?.id),
      activeNodeId: trimText(activeNode?.id),
      activeMainQuest: quest,
      activeNode,
    };
  }

  window.MelodySyncWorkbenchGraphClient = Object.freeze({
    fetchTaskMapGraphForSession,
    resolveTaskMapGraphRootSessionId,
    canReuseTaskMapGraph,
    buildProjectionFromTaskMapGraph,
  });
})();
