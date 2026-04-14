(function workbenchTaskMapClustersModule() {
  const root = typeof globalThis === "object" && globalThis ? globalThis : window;

  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeKey(value) {
    return trimText(value).replace(/\s+/g, " ").toLowerCase();
  }

  function getSessionState(session) {
    return session && typeof session.sessionState === "object" && session.sessionState
      ? session.sessionState
      : null;
  }

  function getTaskRunStatusApi() {
    return root?.MelodySyncTaskRunStatus || root?.window?.MelodySyncTaskRunStatus || null;
  }

  function normalizeWorkflowState(value) {
    const api = getTaskRunStatusApi();
    if (typeof api?.normalizeWorkflowState === "function") {
      return api.normalizeWorkflowState(value);
    }
    return "";
  }

  function resolveBranchLikeStatus(...values) {
    const api = getTaskRunStatusApi();
    if (typeof api?.resolveBranchLikeStatus === "function") {
      return api.resolveBranchLikeStatus(...values);
    }
    return "active";
  }

  function getLineRole(session) {
    const sessionState = getSessionState(session);
    const lineRole = trimText(sessionState?.lineRole || "");
    if (lineRole === "branch" || lineRole === "main") return lineRole;
    return trimText(session?._branchParentSessionId || session?.sourceContext?.parentSessionId) ? "branch" : "main";
  }

  function getBranchStatus(session) {
    return resolveBranchLikeStatus(
      session?._branchStatus,
      session?.branchStatus,
      session?.taskCard?.branchStatus,
      normalizeWorkflowState(session?.workflowState || ""),
    );
  }

  function getSessionCreatedTimestamp(session) {
    const stamp = Date.parse(session?.createdAt || session?.created || session?.updatedAt || session?.lastEventAt || "");
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function inferLongTermBucketFromSession(session) {
    // Delegate to single source in core/task-type-constants.js
    if (root?.MelodySyncTaskTypeConstants?.inferSessionBucket) {
      return root.MelodySyncTaskTypeConstants.inferSessionBucket(session);
    }
    // Fallback (should not be reached if task-type-constants.js is loaded)
    const explicitBucket = normalizeKey(session?.taskPoolMembership?.longTerm?.bucket || "").replace(/[\s-]+/g, "_");
    if (["long_term", "short_term", "waiting", "inbox", "skill"].includes(explicitBucket)) return explicitBucket;
    const kind = normalizeKey(session?.persistent?.kind || "").replace(/[\s-]+/g, "_");
    if (kind === "recurring_task") return "long_term";
    if (kind === "scheduled_task") return "short_term";
    if (kind === "waiting_task") return "waiting";
    const workflowState = normalizeWorkflowState(session?.workflowState || "");
    if (workflowState === "waiting_user") return "waiting";
    return "inbox";
  }

  function getLongTermBucketOrder(session) {
    switch (inferLongTermBucketFromSession(session)) {
      case "long_term":
        return 0;
      case "short_term":
        return 1;
      case "waiting":
        return 2;
      case "inbox":
        return 3;
      default:
        return 4;
    }
  }

  function createSessionMap(sessions = []) {
    return new Map(
      (Array.isArray(sessions) ? sessions : [])
        .filter((session) => session?.id)
        .map((session) => [session.id, session]),
    );
  }

  function createSessionOrderMap(sessions = []) {
    return new Map(
      (Array.isArray(sessions) ? sessions : [])
        .filter((session) => session?.id)
        .map((session, index) => [session.id, index]),
    );
  }

  function createClusterKey(cluster) {
    return trimText(cluster?.mainSessionId || cluster?.mainGoal || cluster?.mainSession?.name || "");
  }

  function sortChildSessions(childSessions, orderMap = new Map()) {
    return [...childSessions].sort((left, right) => {
      const leftBucketOrder = getLongTermBucketOrder(left);
      const rightBucketOrder = getLongTermBucketOrder(right);
      if (leftBucketOrder !== rightBucketOrder) return leftBucketOrder - rightBucketOrder;

      const leftOrder = orderMap.get(left?.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = orderMap.get(right?.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;

      const leftCreated = getSessionCreatedTimestamp(left);
      const rightCreated = getSessionCreatedTimestamp(right);
      if (leftCreated !== rightCreated) return leftCreated - rightCreated;

      return String(left?.id || "").localeCompare(String(right?.id || ""));
    });
  }

  function buildSyntheticClusters(snapshot = {}, sessions = []) {
    const realClusters = Array.isArray(snapshot?.taskClusters) ? snapshot.taskClusters : [];
    const sessionMap = createSessionMap(sessions);
    const sessionOrderMap = createSessionOrderMap(sessions);
    const consumedIds = new Set();
    const consumedQuestKeys = new Set();
    for (const cluster of realClusters) {
      const clusterKey = createClusterKey(cluster);
      if (clusterKey) consumedQuestKeys.add(clusterKey);
      const mainSessionId = trimText(cluster?.mainSessionId || "");
      if (mainSessionId) consumedIds.add(mainSessionId);
      for (const branchSession of Array.isArray(cluster?.branchSessions) ? cluster.branchSessions : []) {
        if (branchSession?.id) consumedIds.add(branchSession.id);
      }
    }

    const branchChildren = new Map();
    for (const session of Array.isArray(sessions) ? sessions : []) {
      if (!session?.id || session?.archived) continue;
      if (consumedIds.has(session.id)) continue;

      // Project members: use taskPoolMembership to establish parent-child
      const projectSessionId = trimText(session?.taskPoolMembership?.longTerm?.projectSessionId || "");
      const memberRole = trimText(session?.taskPoolMembership?.longTerm?.role || "");
      if (projectSessionId && memberRole === "member" && sessionMap.has(projectSessionId)) {
        if (!branchChildren.has(projectSessionId)) {
          branchChildren.set(projectSessionId, []);
        }
        branchChildren.get(projectSessionId).push(session);
        continue;
      }

      // Traditional branch: use sourceContext.parentSessionId lineage
      if (getLineRole(session) !== "branch") continue;
      const parentSessionId = trimText(session?.sourceContext?.parentSessionId || "");
      if (!parentSessionId || !sessionMap.has(parentSessionId)) continue;
      if (!branchChildren.has(parentSessionId)) {
        branchChildren.set(parentSessionId, []);
      }
      branchChildren.get(parentSessionId).push(session);
    }

    function collectBranchSessions(parentSessionId, depth = 1, visited = new Set()) {
      const children = sortChildSessions(branchChildren.get(parentSessionId) || [], sessionOrderMap);
      const results = [];
      for (const child of children) {
        if (!child?.id || visited.has(child.id)) continue;
        visited.add(child.id);
        results.push({
          ...child,
          _branchDepth: depth,
          _branchParentSessionId: parentSessionId,
          _branchStatus: getBranchStatus(child),
        });
        results.push(...collectBranchSessions(child.id, depth + 1, visited));
      }
      return results;
    }

    const clusters = [];
    for (const session of Array.isArray(sessions) ? sessions : []) {
      if (!session?.id || session?.archived) continue;
      if (getLineRole(session) !== "main") continue;
      if (consumedIds.has(session.id)) continue;
      const questKey = trimText(session.id);
      if (questKey && consumedQuestKeys.has(questKey)) continue;
      clusters.push({
        id: `synthetic:${session.id}`,
        _isSynthetic: true,
        mainSessionId: session.id,
        mainSession: session,
        mainGoal: trimText(
          getSessionState(session)?.mainGoal
          || getSessionState(session)?.goal
          || session?.taskCard?.mainGoal
          || session?.taskCard?.goal
          || session?.name
          || "当前任务"
        ),
        currentBranchSessionId: "",
        branchSessionIds: [],
        branchSessions: collectBranchSessions(session.id),
      });
    }

    return clusters;
  }

  function getClusterList(snapshot = {}, sessions = []) {
    const realClusters = Array.isArray(snapshot?.taskClusters) ? snapshot.taskClusters : [];
    return [...realClusters, ...buildSyntheticClusters(snapshot, sessions)];
  }

  function getBranchCurrentLineageSessionIds(cluster, currentBranchSessionId = "") {
    const branchById = new Map(
      (Array.isArray(cluster?.branchSessions) ? cluster.branchSessions : [])
        .filter((entry) => entry?.id)
        .map((entry) => [entry.id, entry]),
    );
    const rootSessionId = trimText(cluster?.mainSessionId || "");
    const lineageIds = new Set();
    let cursor = currentBranchSessionId ? (branchById.get(currentBranchSessionId) || null) : null;
    while (cursor?.id && !lineageIds.has(cursor.id)) {
      lineageIds.add(cursor.id);
      const parentId = trimText(cursor?._branchParentSessionId || "");
      if (!parentId || parentId === rootSessionId) break;
      cursor = branchById.get(parentId) || null;
    }
    return lineageIds;
  }

  root.MelodySyncTaskMapClusters = Object.freeze({
    sortChildSessions,
    buildSyntheticClusters,
    getClusterList,
    getBranchCurrentLineageSessionIds,
  });
})();
