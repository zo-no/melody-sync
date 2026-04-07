(function workbenchGraphClientModule() {
  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeKey(value) {
    return trimText(value).replace(/\s+/g, " ").toLowerCase();
  }

  function normalizeWorkflowState(value) {
    const normalized = normalizeKey(value);
    if (!normalized) return "";
    if (["done", "complete", "completed", "finished"].includes(normalized)) return "done";
    if (["parked", "paused", "pause", "backlog", "todo"].includes(normalized)) return "parked";
    if (["waiting", "waiting_user", "waiting_for_user", "waiting_on_user", "needs_user", "needs_input"].includes(normalized)) {
      return "waiting_user";
    }
    return "";
  }

  function resolveBranchLikeStatus(...values) {
    let sawActive = false;
    let sawParked = false;
    let sawResolved = false;
    let sawMerged = false;

    for (const value of values) {
      const normalized = normalizeKey(value);
      if (!normalized) continue;
      if (normalized === "merged") {
        sawMerged = true;
        continue;
      }
      if (["resolved", "done", "closed", "complete", "completed", "finished"].includes(normalized)) {
        sawResolved = true;
        continue;
      }
      if (["parked", "paused", "pause", "backlog", "todo"].includes(normalized)) {
        sawParked = true;
        continue;
      }
      if (["active", "running", "current", "main", "waiting", "waiting_user"].includes(normalized)) {
        sawActive = true;
      }
    }

    if (sawMerged) return "merged";
    if (sawResolved) return "resolved";
    if (sawParked) return "parked";
    if (sawActive) return "active";
    return "active";
  }

  function getNodeEffectsApi() {
    return globalThis?.MelodySyncWorkbenchNodeEffects
      || globalThis?.window?.MelodySyncWorkbenchNodeEffects
      || null;
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

  function resolveSessionRecord(sessionId = "", { getSessionRecord = () => null, getCurrentSession = () => null } = {}) {
    const normalizedSessionId = trimText(sessionId);
    if (!normalizedSessionId) return null;
    const currentSession = getCurrentSession?.() || null;
    if (trimText(currentSession?.id) === normalizedSessionId) return currentSession;
    return getSessionRecord?.(normalizedSessionId) || null;
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

      if (normalizeKey(node?.kind) === "branch") {
        node.status = resolveBranchLikeStatus(
          node?.status,
          session?._branchStatus,
          session?.branchStatus,
          session?.taskCard?.branchStatus,
          branchContext?.status,
          normalizeWorkflowState(session?.workflowState || ""),
        );
        continue;
      }

      if (normalizeKey(node?.kind) === "main") {
        const workflowState = normalizeWorkflowState(session?.workflowState || "");
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
    quest.nodeIds = Array.isArray(quest?.nodeIds) && quest.nodeIds.length > 0
      ? quest.nodeIds
      : nodes.map((node) => node.id);
    quest.edgeIds = Array.isArray(quest?.edgeIds) && quest.edgeIds.length > 0
      ? quest.edgeIds
      : edges.map((edge) => edge.id);
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
