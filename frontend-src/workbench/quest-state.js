(function questStateModule() {
  function createSelector({
    getSnapshot = () => ({}),
    getCurrentSession = () => null,
    getFocusedSession = () => null,
    getSessionRecord = () => null,
    normalizeSessionId = (value) => String(value || "").trim(),
    normalizeTitle = (value) => String(value || "").trim(),
    toTaskBarSummary = (value) => String(value || "").trim(),
    clipText = (value) => String(value || "").trim(),
    shouldHideTrackerNext = () => false,
    getTaskCard = () => null,
    getTaskCardList = () => [],
    isSessionAwaitingFirstMessage = () => false,
    getResolvedClusterCurrentBranchSessionId = () => "",
    getSessionDisplayName = (session) => String(session?.name || "").trim(),
    getBranchDisplayName = (session) => String(session?.name || "").trim(),
  } = {}) {
    function getClusterForSession(sessionId) {
      if (!sessionId) return null;
      const snapshot = getSnapshot() || {};
      const clusters = Array.isArray(snapshot.taskClusters) ? snapshot.taskClusters : [];
      const match = clusters.find((cluster) => (
        cluster?.mainSessionId === sessionId
        || cluster?.currentBranchSessionId === sessionId
        || (Array.isArray(cluster?.branchSessionIds) && cluster.branchSessionIds.includes(sessionId))
      )) || null;
      return match || buildLocalClusterForSession(sessionId);
    }

    function getActiveSessionContext(sessionId) {
      const snapshot = getSnapshot() || {};
      return (Array.isArray(snapshot.branchContexts) ? snapshot.branchContexts : []).find((entry) => (
        entry?.sessionId === sessionId
        && String(entry?.status || "active").toLowerCase() === "active"
      )) || null;
    }

    function getLatestSessionContext(sessionId) {
      const snapshot = getSnapshot() || {};
      const matches = (Array.isArray(snapshot.branchContexts) ? snapshot.branchContexts : []).filter((entry) => (
        entry?.sessionId === sessionId
      ));
      if (!matches.length) return null;
      return [...matches].sort((left, right) => {
        const leftTime = Date.parse(left?.updatedAt || left?.createdAt || "") || 0;
        const rightTime = Date.parse(right?.updatedAt || right?.createdAt || "") || 0;
        return rightTime - leftTime;
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
      const current = getSessionRecord(sessionId) || getCurrentSession();
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
      const checkpoint = String(getTaskCard(leadSession)?.checkpoint || "").trim();
      if (checkpoint) return clipText(checkpoint, 88);
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
      const checkpoint = clipText(state?.taskCard?.checkpoint || "", 88);
      if (checkpoint) return checkpoint;
      const nextStep = clipText(state.nextStep || "", 88);
      if (nextStep) return nextStep;
      const clusterSummary = getClusterSummary(state.cluster);
      if (clusterSummary) return clusterSummary;
      return "";
    }

    function deriveQuestState() {
      const focusedSession = getFocusedSession();
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
        (!isBranch ? (liveSession.name || "") : "")
        || activeContext?.mainGoal
        || latestContext?.mainGoal
        || taskCard?.mainGoal
        || cluster?.mainGoal
        || clusterMainSession?.taskCard?.mainGoal
        || clusterMainSession?.taskCard?.goal
        || taskCard?.goal
        || liveSession.name
        || "当前主线",
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
        mainGoal,
        currentGoal,
        nextStep,
        branchFrom,
        parentSessionId,
        parentSession,
        cluster,
        resolvedCurrentBranchSessionId,
        hasBranches,
        candidateBranchCount: getTaskCardList(taskCard, "candidateBranches").length,
        awaitingFirstMessage: isSessionAwaitingFirstMessage(liveSession),
        branchLineage,
        activeBranchChain,
        totalBranchCount,
        branchNames,
        mainOverview,
      };
    }

    return {
      deriveQuestState,
      getActiveSessionContext,
      getBranchLineageForSession,
      getClusterForSession,
      getClusterSummary,
      getClusterTitle,
      getCurrentTaskSummary,
      getLatestSessionContext,
    };
  }

  window.MelodySyncQuestState = Object.freeze({
    createSelector,
  });
})();
