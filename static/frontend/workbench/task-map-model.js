(function taskMapModelModule() {
  const FALLBACK_NODE_KIND_DEFINITIONS = Object.freeze([
    Object.freeze({
      id: "main",
      label: "主任务",
      description: "主任务根节点，对应主 session。",
      sessionBacked: true,
      derived: false,
    }),
    Object.freeze({
      id: "branch",
      label: "子任务",
      description: "已经拆出的真实支线 session。",
      sessionBacked: true,
      derived: false,
    }),
    Object.freeze({
      id: "candidate",
      label: "建议子任务",
      description: "系统建议但尚未真正展开的下一条执行线。",
      sessionBacked: false,
      derived: true,
    }),
    Object.freeze({
      id: "done",
      label: "收束",
      description: "当前主任务下的现有支线已经全部收束。",
      sessionBacked: false,
      derived: true,
    }),
  ]);

  function getNodeKindDefinitions() {
    const external = globalThis?.MelodySyncWorkbenchNodeContract?.NODE_KIND_DEFINITIONS
      || globalThis?.window?.MelodySyncWorkbenchNodeContract?.NODE_KIND_DEFINITIONS;
    if (Array.isArray(external) && external.length > 0) {
      return external;
    }
    return FALLBACK_NODE_KIND_DEFINITIONS;
  }

  const NODE_KIND_DEFINITIONS = getNodeKindDefinitions();
  const NODE_KINDS = Object.freeze(NODE_KIND_DEFINITIONS.map((definition) => definition.id));

  function getNodeEffectsApi() {
    return globalThis?.MelodySyncWorkbenchNodeEffects
      || globalThis?.window?.MelodySyncWorkbenchNodeEffects
      || null;
  }

  function getTaskMapPlanApi() {
    return globalThis?.MelodySyncTaskMapPlan
      || globalThis?.window?.MelodySyncTaskMapPlan
      || null;
  }

  function getGraphModelApi() {
    return globalThis?.MelodySyncWorkbenchGraphModel
      || globalThis?.window?.MelodySyncWorkbenchGraphModel
      || null;
  }

  function getTaskMapClustersApi() {
    return globalThis?.MelodySyncTaskMapClusters
      || globalThis?.window?.MelodySyncTaskMapClusters
      || null;
  }

  function getTaskMapMockPresetsApi() {
    return globalThis?.MelodySyncTaskMapMockPresets
      || globalThis?.window?.MelodySyncTaskMapMockPresets
      || null;
  }

  function getFallbackNodeKindEffect(kind) {
    switch (trimText(kind)) {
      case "main":
        return {
          layoutVariant: "root",
          edgeVariant: "structural",
          interaction: "open-session",
          trackAsCandidateChild: false,
          defaultSummary: "",
          countsAs: { sessionNode: true, branch: false, candidate: false },
        };
      case "branch":
        return {
          layoutVariant: "default",
          edgeVariant: "structural",
          interaction: "open-session",
          trackAsCandidateChild: false,
          defaultSummary: "",
          countsAs: { sessionNode: true, branch: true, candidate: false },
        };
      case "candidate":
        return {
          layoutVariant: "compact",
          edgeVariant: "suggestion",
          interaction: "create-branch",
          trackAsCandidateChild: true,
          defaultSummary: "建议拆成独立支线",
          countsAs: { sessionNode: false, branch: false, candidate: true },
        };
      case "done":
        return {
          layoutVariant: "compact",
          edgeVariant: "completion",
          interaction: "none",
          trackAsCandidateChild: false,
          defaultSummary: "",
          countsAs: { sessionNode: true, branch: false, candidate: false },
        };
      default:
        return {
          layoutVariant: "default",
          edgeVariant: "structural",
          interaction: "none",
          trackAsCandidateChild: false,
          defaultSummary: "",
          countsAs: { sessionNode: false, branch: false, candidate: false },
        };
    }
  }

  function getNodeKindEffect(kind) {
    const effect = getNodeEffectsApi()?.getNodeKindEffect?.(kind);
    return effect || getFallbackNodeKindEffect(kind);
  }

  function withNodeKindEffect(node) {
    const nextNode = getNodeEffectsApi()?.withNodeKindEffect?.(node);
    if (nextNode && typeof nextNode === "object") return nextNode;
    return {
      ...node,
      kindEffect: getNodeKindEffect(node?.kind),
    };
  }

  function shouldTrackCandidateChild(node) {
    const tracked = getNodeEffectsApi()?.shouldTrackCandidateChild?.(node);
    if (typeof tracked === "boolean") return tracked;
    return getNodeKindEffect(node?.kind)?.trackAsCandidateChild === true;
  }

  function countsAsBranch(node) {
    return node?.kindEffect?.countsAs?.branch === true
      || getNodeKindEffect(node?.kind)?.countsAs?.branch === true;
  }

  function buildQuestNodeCounts(nodes = []) {
    const counts = getNodeEffectsApi()?.buildQuestNodeCounts?.(nodes);
    if (counts && typeof counts === "object") {
      return counts;
    }
    const realNodes = nodes.filter((node) => getNodeKindEffect(node?.kind)?.countsAs?.sessionNode === true);
    const branchNodes = realNodes.filter((node) => countsAsBranch(node));
    return {
      sessionNodes: realNodes.length,
      activeBranches: branchNodes.filter((node) => node.status === "active").length,
      parkedBranches: branchNodes.filter((node) => node.status === "parked").length,
      completedBranches: branchNodes.filter((node) => ["resolved", "merged"].includes(node.status)).length,
      candidateBranches: nodes.filter((node) => getNodeKindEffect(node?.kind)?.countsAs?.candidate === true).length,
    };
  }

  function resolveActiveQuestSelection({
    quests = [],
    currentSessionId = "",
    focusedSessionId = "",
  } = {}) {
    const preferredSessionIds = [trimText(focusedSessionId), trimText(currentSessionId)].filter(Boolean);
    const preferredNodeId = preferredSessionIds
      .map((sessionId) => {
        const sessionNodeId = `session:${sessionId}`;
        const matchedQuest = quests.find((quest) => Array.isArray(quest?.nodeIds) && quest.nodeIds.includes(sessionNodeId));
        if (matchedQuest) return sessionNodeId;
        const matchedNode = quests.flatMap((quest) => Array.isArray(quest?.nodes) ? quest.nodes : []).find((node) => (
          trimText(node?.sessionId) === sessionId
        ));
        return matchedNode?.id || "";
      })
      .find(Boolean) || "";
    const activeQuest = (preferredNodeId
      ? quests.find((quest) => Array.isArray(quest?.nodeIds) && quest.nodeIds.includes(preferredNodeId))
      : null)
      || quests.find((quest) => quest.currentNodeId === `session:${currentSessionId}`)
      || quests[0]
      || null;
    const activeNode = activeQuest
      ? activeQuest.nodes.find((node) => node.id === (preferredNodeId && activeQuest.nodeIds.includes(preferredNodeId) ? preferredNodeId : activeQuest.currentNodeId)) || null
      : null;
    return {
      activeMainQuestId: activeQuest?.id || "",
      activeNodeId: activeNode?.id || "",
      activeMainQuest: activeQuest,
      activeNode,
    };
  }

  function cloneJson(value) {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeText(value) {
    return trimText(value).replace(/\s+/g, " ");
  }

  function clipText(value, max = 96) {
    const text = normalizeText(value);
    if (!text) return "";
    if (!Number.isInteger(max) || max <= 0 || text.length <= max) return text;
    if (max === 1) return "…";
    return `${text.slice(0, max - 1).trimEnd()}…`;
  }

  function normalizeKey(value) {
    return normalizeText(value).toLowerCase();
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

  function slugify(value) {
    const slug = normalizeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
    return slug || "untitled";
  }

  function getTaskCard(session) {
    return session?.taskCard && typeof session.taskCard === "object" ? session.taskCard : null;
  }

  function getTaskCardList(taskCard, key) {
    return Array.isArray(taskCard?.[key])
      ? taskCard[key].filter((entry) => typeof entry === "string" && entry.trim())
      : [];
  }

  function getSessionTimestamp(session) {
    const stamp = Date.parse(session?.updatedAt || session?.lastEventAt || session?.created || "");
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function getSessionCreatedTimestamp(session) {
    const stamp = Date.parse(session?.createdAt || session?.created || session?.updatedAt || session?.lastEventAt || "");
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function getLineRole(session) {
    return trimText(session?._branchParentSessionId || session?.sourceContext?.parentSessionId) ? "branch" : "main";
  }

  function getBranchStatus(session, branchContext = null) {
    return resolveBranchLikeStatus(
      session?._branchStatus,
      session?.branchStatus,
      session?.taskCard?.branchStatus,
      branchContext?.status,
      normalizeWorkflowState(session?.workflowState || ""),
    );
  }

  function getRootNodeStatus(session, { isCurrent = false } = {}) {
    const workflowState = normalizeWorkflowState(session?.workflowState || "");
    if (workflowState === "done") return "done";
    if (workflowState === "parked") return "parked";
    return isCurrent ? "current" : "main";
  }

  function toConciseGoal(value, max = 56) {
    const compact = normalizeText(value);
    if (!compact) return "";
    const firstSegment = compact
      .split(/[。！？.!?\n]/)
      .map((entry) => entry.trim())
      .find(Boolean);
    return clipText(firstSegment || compact, max);
  }

  function getSessionTitle(session) {
    const name = trimText(session?.name || "");
    const goal = trimText(session?.taskCard?.goal || "");
    const mainGoal = trimText(session?.taskCard?.mainGoal || "");
    const isBranch = getLineRole(session) === "branch";
    return toConciseGoal(
      isBranch
        ? (goal || name || mainGoal || "当前任务")
        : (name || mainGoal || goal || "当前任务"),
      64,
    );
  }

  function getBranchTitle(session) {
    const raw = getSessionTitle(session);
    return raw.replace(/^(?:Branch\s*[·•-]\s*|支线\s*[·•:-]\s*)/i, "").trim() || raw;
  }

  function getNodeSummary(session) {
    const taskCard = getTaskCard(session);
    const checkpoint = trimText(taskCard?.checkpoint || "");
    const nextStep = getTaskCardList(taskCard, "nextSteps")[0] || "";
    const summary = trimText(taskCard?.summary || "");
    return clipText(checkpoint || nextStep || summary || "", 88);
  }

  function createSessionMap(sessions = []) {
    return new Map(
      (Array.isArray(sessions) ? sessions : [])
        .filter((session) => session?.id)
        .map((session) => [session.id, session]),
    );
  }

  function getCandidateKeysForSession(session) {
    return new Set([
      normalizeKey(getSessionTitle(session)),
      normalizeKey(getBranchTitle(session)),
      normalizeKey(session?.taskCard?.goal || ""),
      normalizeKey(session?.taskCard?.summary || ""),
      normalizeKey(session?.taskCard?.checkpoint || ""),
    ].filter(Boolean));
  }

  function buildTaskMapProjection({ snapshot = {}, sessions = [], currentSessionId = "", focusedSessionId = "" } = {}) {
    const sessionMap = createSessionMap(sessions);
    const clusters = getTaskMapClustersApi()?.getClusterList?.(snapshot, sessions, currentSessionId)
      || [];
    // Index branchContexts by sessionId for O(1) lookup
    const branchContextBySessionId = new Map(
      (Array.isArray(snapshot?.branchContexts) ? snapshot.branchContexts : [])
        .filter((ctx) => ctx?.sessionId)
        .map((ctx) => [trimText(ctx.sessionId), ctx]),
    );
    const quests = [];
    const preferredSessionIds = [trimText(focusedSessionId), trimText(currentSessionId)].filter(Boolean);

    for (const cluster of clusters) {
      const rootSessionId = trimText(cluster?.mainSessionId || "");
      const rootSession = sessionMap.get(rootSessionId) || cluster?.mainSession || null;
      if (!rootSession?.id) continue;

      const questId = `quest:${rootSession.id}`;
      const rootNodeId = `session:${rootSession.id}`;
      const currentBranchSessionId = trimText(cluster?.currentBranchSessionId || "");
      const branchSessionIds = new Set(
        (Array.isArray(cluster?.branchSessions) ? cluster.branchSessions : [])
          .filter((entry) => entry?.id)
          .map((entry) => trimText(entry.id)),
      );
      const resolvedActiveSessionId = preferredSessionIds.find((sessionId) => (
        sessionId === rootSession.id || branchSessionIds.has(sessionId)
      )) || currentBranchSessionId || rootSession.id;
      const resolvedCurrentBranchSessionId = resolvedActiveSessionId === rootSession.id
        ? ""
        : resolvedActiveSessionId;
      const activeNodeId = resolvedActiveSessionId === rootSession.id
        ? rootNodeId
        : `session:${resolvedActiveSessionId}`;
      const currentLineageIds = getTaskMapClustersApi()?.getBranchCurrentLineageSessionIds?.(cluster, resolvedCurrentBranchSessionId)
        || new Set();
      const branchSessions = Array.isArray(cluster?.branchSessions)
        ? cluster.branchSessions.filter((entry) => entry?.id)
        : [];
      const branchOrderMap = new Map(branchSessions.map((entry, index) => [entry.id, index]));
      const childrenByParent = new Map();
      for (const branchSession of branchSessions) {
        const parentSessionId = trimText(branchSession?._branchParentSessionId || "") || rootSession.id;
        const resolvedParentId = parentSessionId || rootSession.id;
        if (!childrenByParent.has(resolvedParentId)) {
          childrenByParent.set(resolvedParentId, []);
        }
        childrenByParent.get(resolvedParentId).push(branchSession);
      }
      for (const [parentId, children] of childrenByParent.entries()) {
        childrenByParent.set(parentId, getTaskMapClustersApi()?.sortChildSessions?.(children, branchOrderMap) || [...children]);
      }

      const graphModel = getGraphModelApi();
      const graphCollections = graphModel?.createQuestGraphCollections?.({ questId });
      const nodes = graphCollections?.nodes || [];
      const nodeById = graphCollections?.nodeById || new Map();
      const edges = graphCollections?.edges || [];

      function addNode(node) {
        if (!graphCollections || !graphModel) {
          const nextNode = withNodeKindEffect({
            childNodeIds: [],
            candidateNodeIds: [],
            isCurrent: false,
            isCurrentPath: false,
            ...node,
          });
          nodes.push(nextNode);
          nodeById.set(nextNode.id, nextNode);
          if (nextNode.parentNodeId) {
            const parentNode = nodeById.get(nextNode.parentNodeId);
            if (parentNode) {
              parentNode.childNodeIds.push(nextNode.id);
              if (shouldTrackCandidateChild(nextNode)) {
                parentNode.candidateNodeIds.push(nextNode.id);
              }
              edges.push({
                id: `edge:${parentNode.id}:${nextNode.id}`,
                questId,
                fromNodeId: parentNode.id,
                toNodeId: nextNode.id,
                type: nextNode?.kindEffect?.edgeVariant || "structural",
              });
            }
          }
          return nextNode;
        }
        return graphModel.appendGraphNode(graphCollections, {
          childNodeIds: [],
          candidateNodeIds: [],
          isCurrent: false,
          isCurrentPath: false,
          ...node,
        });
      }

      addNode({
        id: rootNodeId,
        questId,
        kind: "main",
        lineRole: "main",
        sessionId: rootSession.id,
        sourceSessionId: rootSession.id,
        parentNodeId: null,
        depth: 0,
        title: getSessionTitle(rootSession),
        summary: getNodeSummary(rootSession),
        status: getRootNodeStatus(rootSession, { isCurrent: activeNodeId === rootNodeId }),
        isCurrent: activeNodeId === rootNodeId,
        isCurrentPath: activeNodeId === rootNodeId,
      });

      function appendCandidateNodes(parentSession, parentNodeId, depth, directChildSessions = []) {
        const parentTaskCard = getTaskCard(parentSession);
        const rawCandidates = getTaskCardList(parentTaskCard, "candidateBranches");
        if (!rawCandidates.length) return;

        const existingChildKeys = new Set();
        for (const childSession of directChildSessions) {
          for (const key of getCandidateKeysForSession(childSession)) {
            existingChildKeys.add(key);
          }
        }

        const seenCandidates = new Set();
        for (const candidateTitle of rawCandidates) {
          const normalizedTitle = toConciseGoal(candidateTitle, 64);
          const candidateKey = normalizeKey(normalizedTitle);
          if (!candidateKey || seenCandidates.has(candidateKey) || existingChildKeys.has(candidateKey)) continue;
          seenCandidates.add(candidateKey);
          const candidateEffect = getNodeKindEffect("candidate");
          addNode({
            id: `candidate:${parentSession.id}:${slugify(normalizedTitle)}`,
            questId,
            kind: "candidate",
            lineRole: "candidate",
            sessionId: "",
            sourceSessionId: parentSession.id,
            parentNodeId,
            depth,
            title: normalizedTitle,
            summary: candidateEffect.defaultSummary || "建议拆成独立支线",
            status: "candidate",
          });
        }
      }

      function appendBranchTree(parentSessionId, parentNodeId, depth) {
        const directChildSessions = childrenByParent.get(parentSessionId) || [];
        for (const branchSession of directChildSessions) {
          const nodeId = `session:${branchSession.id}`;
          const branchCtx = branchContextBySessionId.get(trimText(branchSession.id));
          const branchStatus = getBranchStatus(branchSession, branchCtx);
          const isMerged = branchStatus === "merged" || branchStatus === "resolved";
          // Show conclusion text on merged/resolved branches
          const conclusionText = isMerged
            ? trimText(branchCtx?.checkpointSummary || "")
            : "";
          addNode({
            id: nodeId,
            questId,
            kind: "branch",
            lineRole: "branch",
            sessionId: branchSession.id,
            sourceSessionId: branchSession.id,
            parentNodeId,
            depth,
            title: getBranchTitle(branchSession),
            summary: conclusionText || getNodeSummary(branchSession),
            status: branchStatus,
            isCurrent: nodeId === activeNodeId,
            isCurrentPath: currentLineageIds.has(branchSession.id),
            conclusionText,
          });
          appendBranchTree(branchSession.id, nodeId, depth + 1);
          appendCandidateNodes(branchSession, nodeId, depth + 1, childrenByParent.get(branchSession.id) || []);
        }
      }

      appendBranchTree(rootSession.id, rootNodeId, 1);
      appendCandidateNodes(rootSession, rootNodeId, 1, childrenByParent.get(rootSession.id) || []);

      // Done node: appears when all branches are resolved/merged (task fully closed).
      // Requires at least one branch to exist — no branches means the task hasn't split yet.
      {
        const directBranches = childrenByParent.get(rootSession.id) || [];
        const allBranchNodes = nodes.filter((node) => countsAsBranch(node));
        const hasOpenBranches = allBranchNodes.some((n) => n.status === "active" || n.status === "parked");
        if (directBranches.length > 0 && allBranchNodes.length > 0 && !hasOpenBranches) {
          addNode({
            id: `done:${rootSession.id}`,
            questId,
            kind: "done",
            lineRole: "main",
            sessionId: rootSession.id,
            sourceSessionId: rootSession.id,
            parentNodeId: rootNodeId,
            depth: 1,
            title: "任务收束",
            summary: `${allBranchNodes.length} 条支线已全部完成`,
            status: "done",
          });
        }
      }

      const questTitle = clipText(
        trimText(rootSession?.name || cluster?.mainGoal || rootSession?.taskCard?.mainGoal || rootSession?.taskCard?.goal || "当前任务"),
        72,
      );
      const activeNode = nodeById.get(activeNodeId) || nodeById.get(rootNodeId) || null;
      const currentPathNodeIds = nodes
        .filter((node) => node.isCurrent || node.isCurrentPath)
        .map((node) => node.id);
      if (graphModel && graphCollections) {
        quests.push(graphModel.buildQuestGraphSnapshot({
          collections: graphCollections,
          questId,
          rootSessionId: rootSession.id,
          title: questTitle,
          summary: getNodeSummary(rootSession),
          currentNodeId: activeNode?.id || rootNodeId,
          currentNodeTitle: activeNode?.title || getSessionTitle(rootSession),
          currentPathNodeIds,
        }));
      } else {
        const questCounts = buildQuestNodeCounts(nodes);
        quests.push({
          id: questId,
          rootSessionId: rootSession.id,
          title: questTitle,
          summary: getNodeSummary(rootSession),
          currentNodeId: activeNode?.id || rootNodeId,
          currentNodeTitle: activeNode?.title || getSessionTitle(rootSession),
          currentPathNodeIds,
          nodeIds: nodes.map((node) => node.id),
          edgeIds: edges.map((edge) => edge.id),
          nodes,
          edges,
          counts: questCounts,
        });
      }
    }

    const planAdjustedProjection = getTaskMapPlanApi()?.applyTaskMapPlansToProjection?.({
      projection: { mainQuests: quests },
      snapshot,
    }) || { mainQuests: quests };

    return {
      mainQuests: planAdjustedProjection.mainQuests || quests,
      ...resolveActiveQuestSelection({
        quests: planAdjustedProjection.mainQuests || quests,
        currentSessionId,
        focusedSessionId,
      }),
    };
  }

  function applyTaskMapMockPreset(projection, preset) {
    return getTaskMapMockPresetsApi()?.applyTaskMapMockPreset?.(projection, preset) || projection;
  }

  window.MelodySyncTaskMapModel = {
    NODE_KIND_DEFINITIONS,
    NODE_KINDS,
    buildTaskMapProjection,
    applyTaskMapMockPreset,
  };
})();
