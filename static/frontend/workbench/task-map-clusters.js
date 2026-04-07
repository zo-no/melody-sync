(function workbenchTaskMapClustersModule() {
  const root = typeof globalThis === "object" && globalThis ? globalThis : window;

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

  function getLineRole(session) {
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
      if (getLineRole(session) !== "branch") continue;
      if (consumedIds.has(session.id)) continue;
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
        mainGoal: trimText(session?.taskCard?.mainGoal || session?.taskCard?.goal || session?.name || "当前任务"),
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
