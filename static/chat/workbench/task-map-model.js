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

  function getBranchStatus(session) {
    const status = normalizeKey(session?._branchStatus || "");
    if (["active", "parked", "resolved", "merged"].includes(status)) return status;
    return "active";
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

  function buildSyntheticClusters(snapshot = {}, sessions = [], currentSessionId = "") {
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
      const children = [...(branchChildren.get(parentSessionId) || [])].sort((left, right) => {
        const leftOrder = sessionOrderMap.get(left?.id) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = sessionOrderMap.get(right?.id) ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;

        const leftCreated = getSessionCreatedTimestamp(left);
        const rightCreated = getSessionCreatedTimestamp(right);
        if (leftCreated !== rightCreated) return leftCreated - rightCreated;

        return String(left?.id || "").localeCompare(String(right?.id || ""));
      });
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

  function getClusterList(snapshot = {}, sessions = [], currentSessionId = "") {
    const realClusters = Array.isArray(snapshot?.taskClusters) ? snapshot.taskClusters : [];
    return [...realClusters, ...buildSyntheticClusters(snapshot, sessions, currentSessionId)];
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

  function getCandidateKeysForSession(session) {
    return new Set([
      normalizeKey(getSessionTitle(session)),
      normalizeKey(getBranchTitle(session)),
      normalizeKey(session?.taskCard?.goal || ""),
      normalizeKey(session?.taskCard?.summary || ""),
      normalizeKey(session?.taskCard?.checkpoint || ""),
    ].filter(Boolean));
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

  function buildTaskMapProjection({ snapshot = {}, sessions = [], currentSessionId = "", focusedSessionId = "" } = {}) {
    const sessionMap = createSessionMap(sessions);
    const clusters = getClusterList(snapshot, sessions, currentSessionId);
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
      const currentLineageIds = getBranchCurrentLineageSessionIds(cluster, resolvedCurrentBranchSessionId);
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
        childrenByParent.set(parentId, sortChildSessions(children, branchOrderMap));
      }

      const nodes = [];
      const nodeById = new Map();
      const edges = [];

      function addNode(node) {
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
        status: activeNodeId === rootNodeId ? "current" : "main",
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
          const branchStatus = getBranchStatus(branchSession);
          const branchCtx = branchContextBySessionId.get(trimText(branchSession.id));
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
      const questCounts = buildQuestNodeCounts(nodes);

      quests.push({
        id: questId,
        rootSessionId: rootSession.id,
        title: questTitle,
        summary: getNodeSummary(rootSession),
        currentNodeId: activeNode?.id || rootNodeId,
        currentNodeTitle: activeNode?.title || getSessionTitle(rootSession),
        currentPathNodeIds: nodes.filter((node) => node.isCurrent || node.isCurrentPath).map((node) => node.id),
        nodeIds: nodes.map((node) => node.id),
        edgeIds: edges.map((edge) => edge.id),
        nodes,
        edges,
        counts: questCounts,
      });
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

  function normalizeMockPresetName(value) {
    const normalized = normalizeKey(value);
    if (!normalized) return "";
    if (["demo", "branch-demo", "cinema", "movie", "movie-study"].includes(normalized)) {
      return "cinema";
    }
    return "";
  }

  function recalculateQuestCounts(quest) {
    quest.counts = {
      ...quest.counts,
      ...buildQuestNodeCounts(quest.nodes),
    };
  }

  function applyCinemaMockPreset(projection) {
    const cloned = cloneJson(projection);
    const activeQuest = cloned?.mainQuests?.find((quest) => quest.id === cloned.activeMainQuestId)
      || cloned?.mainQuests?.[0]
      || null;
    if (!activeQuest) return cloned;

    if (activeQuest.nodes.some((node) => String(node?.id || "").startsWith("mock:cinema:"))) {
      cloned.activeMainQuest = activeQuest;
      cloned.activeNode = activeQuest.nodes.find((node) => node.id === cloned.activeNodeId) || cloned.activeNode || null;
      return cloned;
    }

    const nodeById = new Map(activeQuest.nodes.filter((node) => node?.id).map((node) => [node.id, node]));
    const rootNodeId = `session:${activeQuest.rootSessionId || ""}`;
    const rootNode = nodeById.get(rootNodeId);
    if (!rootNode) return cloned;

    function appendNode(node) {
      const nextNode = withNodeKindEffect({
        childNodeIds: [],
        candidateNodeIds: [],
        isCurrent: false,
        isCurrentPath: false,
        ...node,
      });
      activeQuest.nodes.push(nextNode);
      activeQuest.nodeIds.push(nextNode.id);
      nodeById.set(nextNode.id, nextNode);
      if (nextNode.parentNodeId) {
        const parentNode = nodeById.get(nextNode.parentNodeId);
        if (parentNode) {
          parentNode.childNodeIds = Array.isArray(parentNode.childNodeIds) ? parentNode.childNodeIds : [];
          parentNode.candidateNodeIds = Array.isArray(parentNode.candidateNodeIds) ? parentNode.candidateNodeIds : [];
          parentNode.childNodeIds.push(nextNode.id);
          if (shouldTrackCandidateChild(nextNode)) {
            parentNode.candidateNodeIds.push(nextNode.id);
          }
        }
      }
      return nextNode;
    }

    appendNode({
      id: "mock:cinema:branch:visual-style",
      questId: activeQuest.id,
      kind: "branch",
      lineRole: "branch",
      sessionId: "",
      sourceSessionId: activeQuest.rootSessionId,
      parentNodeId: rootNodeId,
      depth: 1,
      title: "视觉风格线",
      summary: "单独研究风格谱系与代表作品",
      status: "active",
    });

    appendNode({
      id: "mock:cinema:branch:expressionism",
      questId: activeQuest.id,
      kind: "branch",
      lineRole: "branch",
      sessionId: "",
      sourceSessionId: activeQuest.rootSessionId,
      parentNodeId: "mock:cinema:branch:visual-style",
      depth: 2,
      title: "德国表现主义",
      summary: "聚焦布景、光影和美术影响",
      status: "parked",
    });

    appendNode({
      id: "mock:cinema:branch:new-wave",
      questId: activeQuest.id,
      kind: "branch",
      lineRole: "branch",
      sessionId: "",
      sourceSessionId: activeQuest.rootSessionId,
      parentNodeId: "mock:cinema:branch:visual-style",
      depth: 2,
      title: "法国新浪潮",
      summary: "拆作者论、跳切和代表导演",
      status: "parked",
    });

    appendNode({
      id: "mock:cinema:candidate:film-list",
      questId: activeQuest.id,
      kind: "candidate",
      lineRole: "candidate",
      sessionId: "",
      sourceSessionId: activeQuest.rootSessionId,
      parentNodeId: rootNodeId,
      depth: 1,
      title: "生成 12 周片单",
      summary: "建议拆成独立支线",
      status: "candidate",
    });

    appendNode({
      id: "mock:cinema:candidate:asia-line",
      questId: activeQuest.id,
      kind: "candidate",
      lineRole: "candidate",
      sessionId: "",
      sourceSessionId: activeQuest.rootSessionId,
      parentNodeId: rootNodeId,
      depth: 1,
      title: "按亚洲线重排",
      summary: "建议拆成独立支线",
      status: "candidate",
    });

    appendNode({
      id: "mock:cinema:candidate:noir",
      questId: activeQuest.id,
      kind: "candidate",
      lineRole: "candidate",
      sessionId: "",
      sourceSessionId: activeQuest.rootSessionId,
      parentNodeId: "mock:cinema:branch:visual-style",
      depth: 2,
      title: "黑色电影",
      summary: "建议拆成独立支线",
      status: "candidate",
    });

    recalculateQuestCounts(activeQuest);
    activeQuest.edgeIds = Array.isArray(activeQuest.edgeIds) ? activeQuest.edgeIds : [];
    activeQuest.edges = Array.isArray(activeQuest.edges) ? activeQuest.edges : [];
    for (const node of activeQuest.nodes) {
      if (!node?.parentNodeId) continue;
      const edgeId = `edge:${node.parentNodeId}:${node.id}`;
      if (activeQuest.edgeIds.includes(edgeId)) continue;
      activeQuest.edgeIds.push(edgeId);
      activeQuest.edges.push({
        id: edgeId,
        questId: activeQuest.id,
        fromNodeId: node.parentNodeId,
        toNodeId: node.id,
        type: node?.kindEffect?.edgeVariant || "structural",
      });
    }
    cloned.activeMainQuest = activeQuest;
    cloned.activeNode = activeQuest.nodes.find((node) => node.id === cloned.activeNodeId) || cloned.activeNode || null;
    return cloned;
  }

  function applyTaskMapMockPreset(projection, preset) {
    const normalizedPreset = normalizeMockPresetName(preset);
    if (!normalizedPreset || !projection || typeof projection !== "object") return projection;
    if (normalizedPreset === "cinema") {
      return applyCinemaMockPreset(projection);
    }
    return projection;
  }

  window.MelodySyncTaskMapModel = {
    NODE_KIND_DEFINITIONS,
    NODE_KINDS,
    buildTaskMapProjection,
    applyTaskMapMockPreset,
  };
})();
