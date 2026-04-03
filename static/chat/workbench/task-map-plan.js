(function taskMapPlanModule() {
  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function cloneJson(value) {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function getNodeContract() {
    return globalThis?.MelodySyncWorkbenchNodeContract
      || globalThis?.window?.MelodySyncWorkbenchNodeContract
      || null;
  }

  function getNodeEffectsApi() {
    return globalThis?.MelodySyncWorkbenchNodeEffects
      || globalThis?.window?.MelodySyncWorkbenchNodeEffects
      || null;
  }

  function normalizePlanMode(value) {
    return trimText(value).toLowerCase() === "augment-default"
      ? "augment-default"
      : "replace-default";
  }

  function normalizeEdgeType(value) {
    const normalized = trimText(value).toLowerCase();
    return ["structural", "suggestion", "completion", "merge"].includes(normalized)
      ? normalized
      : "structural";
  }

  function normalizePlanSourceType(value) {
    const normalized = trimText(value).toLowerCase();
    return ["manual", "system", "hook"].includes(normalized)
      ? normalized
      : "manual";
  }

  function normalizeAllowedTokenList(values, allowlist) {
    if (!Array.isArray(values) || values.length === 0) return [];
    const normalized = values
      .map((value) => trimText(value).toLowerCase())
      .filter((value) => allowlist.includes(value));
    return [...new Set(normalized)];
  }

  function normalizeDimension(value, { min = 120, max = 1280 } = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const normalized = Math.round(numeric);
    if (normalized < min || normalized > max) return null;
    return normalized;
  }

  function normalizeNodeViewType(value) {
    const normalized = trimText(value).toLowerCase();
    return ["flow-node", "markdown", "html", "iframe"].includes(normalized)
      ? normalized
      : "flow-node";
  }

  function normalizeHtmlRenderMode(value) {
    const normalized = trimText(value).toLowerCase();
    return ["inline", "iframe"].includes(normalized)
      ? normalized
      : "iframe";
  }

  function normalizeNodeStatus(value) {
    const normalized = trimText(value).toLowerCase();
    return normalized || "active";
  }

  function isKnownNodeKind(kind) {
    const contract = getNodeContract();
    if (contract?.isKnownNodeKind?.(kind)) return true;
    return ["main", "branch", "candidate", "done"].includes(trimText(kind).toLowerCase());
  }

  function normalizeNodeView(view = {}) {
    if (!view || typeof view !== "object" || Array.isArray(view)) return null;
    const type = normalizeNodeViewType(view.type);
    return {
      type,
      renderMode: type === "html" ? normalizeHtmlRenderMode(view.renderMode) : "",
      content: typeof view.content === "string" ? view.content : "",
      src: trimText(view.src),
      width: normalizeDimension(view.width, { min: 180, max: 1440 }),
      height: normalizeDimension(view.height, { min: 120, max: 1200 }),
    };
  }

  function withNodeKindEffect(node) {
    return getNodeEffectsApi()?.withNodeKindEffect?.(node) || {
      ...node,
      kindEffect: getNodeEffectsApi()?.getNodeKindEffect?.(node?.kind) || null,
    };
  }

  function shouldTrackCandidateChild(node) {
    return getNodeEffectsApi()?.shouldTrackCandidateChild?.(node) === true;
  }

  function buildQuestNodeCounts(nodes = []) {
    return getNodeEffectsApi()?.buildQuestNodeCounts?.(nodes) || {
      sessionNodes: 0,
      activeBranches: 0,
      parkedBranches: 0,
      completedBranches: 0,
      candidateBranches: 0,
    };
  }

  function normalizePlanNode(node = {}, { existingNodeIds = new Set() } = {}) {
    const id = trimText(node.id);
    const kind = trimText(node.kind).toLowerCase();
    if (!id || existingNodeIds.has(id) || !isKnownNodeKind(kind)) return null;
    return {
      id,
      kind,
      title: trimText(node.title || id),
      summary: trimText(node.summary),
      sessionId: trimText(node.sessionId),
      sourceSessionId: trimText(node.sourceSessionId || node.sessionId),
      parentNodeId: trimText(node.parentNodeId || node.parentId),
      status: normalizeNodeStatus(node.status),
      lineRole: trimText(node.lineRole).toLowerCase(),
      capabilities: normalizeAllowedTokenList(node.capabilities, ["open-session", "create-branch", "dismiss"]),
      surfaceBindings: normalizeAllowedTokenList(node.surfaceBindings, ["task-map", "composer-suggestions"]),
      view: normalizeNodeView(node.view),
    };
  }

  function normalizePlanEdge(edge = {}, { existingEdgeIds = new Set(), nodeIds = new Set() } = {}) {
    const fromNodeId = trimText(edge.fromNodeId || edge.from);
    const toNodeId = trimText(edge.toNodeId || edge.to);
    if (!fromNodeId || !toNodeId || !nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId)) return null;
    const id = trimText(edge.id) || `edge:${fromNodeId}:${toNodeId}`;
    if (existingEdgeIds.has(id)) return null;
    return {
      id,
      fromNodeId,
      toNodeId,
      type: normalizeEdgeType(edge.type),
    };
  }

  function normalizeTaskMapPlan(plan = {}) {
    const rootSessionId = trimText(plan.rootSessionId);
    if (!rootSessionId) return null;

    const nodeIds = new Set();
    const nodes = [];
    for (const node of Array.isArray(plan.nodes) ? plan.nodes : []) {
      const normalizedNode = normalizePlanNode(node, { existingNodeIds: nodeIds });
      if (!normalizedNode) continue;
      nodeIds.add(normalizedNode.id);
      nodes.push(normalizedNode);
    }
    if (!nodes.length) return null;

    const edgeIds = new Set();
    const edges = [];
    for (const edge of Array.isArray(plan.edges) ? plan.edges : []) {
      const normalizedEdge = normalizePlanEdge(edge, { existingEdgeIds: edgeIds, nodeIds });
      if (!normalizedEdge) continue;
      edgeIds.add(normalizedEdge.id);
      edges.push(normalizedEdge);
    }

    return {
      id: trimText(plan.id) || `plan:${rootSessionId}`,
      questId: trimText(plan.questId) || `quest:${rootSessionId}`,
      rootSessionId,
      mode: normalizePlanMode(plan.mode),
      title: trimText(plan.title),
      summary: trimText(plan.summary),
      activeNodeId: trimText(plan.activeNodeId),
      nodes,
      edges,
      source: plan?.source && typeof plan.source === "object" ? {
        type: normalizePlanSourceType(plan.source.type),
        hookId: trimText(plan.source.hookId),
        event: trimText(plan.source.event),
        generatedAt: trimText(plan.source.generatedAt || plan.source.updatedAt || ""),
        taskMapPlanPolicy: trimText(plan.source.taskMapPlanPolicy).toLowerCase(),
      } : null,
      updatedAt: trimText(plan.updatedAt || ""),
    };
  }

  function normalizeTaskMapPlans(taskMapPlans = []) {
    const normalized = [];
    const seenPlanIds = new Set();
    for (const plan of Array.isArray(taskMapPlans) ? taskMapPlans : []) {
      const nextPlan = normalizeTaskMapPlan(plan);
      if (!nextPlan || seenPlanIds.has(nextPlan.id)) continue;
      seenPlanIds.add(nextPlan.id);
      normalized.push(nextPlan);
    }
    return normalized;
  }

  function buildQuestFromGraphData({
    questId = "",
    rootSessionId = "",
    title = "",
    summary = "",
    activeNodeId = "",
    nodes = [],
    edges = [],
  } = {}) {
    const normalizedRootSessionId = trimText(rootSessionId);
    if (!normalizedRootSessionId || !Array.isArray(nodes) || nodes.length === 0) return null;

    const nextNodes = [];
    const nodeById = new Map();
    for (const node of nodes) {
      const nextNode = withNodeKindEffect({
        childNodeIds: [],
        candidateNodeIds: [],
        isCurrent: false,
        isCurrentPath: false,
        depth: 0,
        ...node,
      });
      nextNodes.push(nextNode);
      nodeById.set(nextNode.id, nextNode);
    }

    const edgeById = new Map();
    const nextEdges = [];
    function appendEdge(edge) {
      if (!edge?.fromNodeId || !edge?.toNodeId) return;
      const edgeId = trimText(edge.id) || `edge:${edge.fromNodeId}:${edge.toNodeId}`;
      if (edgeById.has(edgeId)) return;
      const nextEdge = {
        id: edgeId,
        questId: trimText(questId) || `quest:${normalizedRootSessionId}`,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        type: normalizeEdgeType(edge.type),
      };
      edgeById.set(edgeId, nextEdge);
      nextEdges.push(nextEdge);
    }

    for (const node of nextNodes) {
      if (!node?.parentNodeId) continue;
      const parentNode = nodeById.get(node.parentNodeId);
      if (!parentNode) continue;
      parentNode.childNodeIds.push(node.id);
      if (shouldTrackCandidateChild(node)) {
        parentNode.candidateNodeIds.push(node.id);
      }
      appendEdge({
        id: `edge:${parentNode.id}:${node.id}`,
        fromNodeId: parentNode.id,
        toNodeId: node.id,
        type: node?.kindEffect?.edgeVariant || "structural",
      });
    }

    for (const edge of Array.isArray(edges) ? edges : []) {
      appendEdge(edge);
    }

    const rootNode = nodeById.get(`session:${normalizedRootSessionId}`)
      || nextNodes.find((node) => !trimText(node?.parentNodeId))
      || nextNodes.find((node) => node.kind === "main")
      || null;
    if (!rootNode) return null;

    function assignDepth(nodeId, depth, visited = new Set()) {
      const node = nodeById.get(nodeId);
      if (!node || visited.has(nodeId)) return;
      visited.add(nodeId);
      node.depth = depth;
      for (const childId of Array.isArray(node.childNodeIds) ? node.childNodeIds : []) {
        assignDepth(childId, depth + 1, visited);
      }
    }

    assignDepth(rootNode.id, 0, new Set());

    const resolvedActiveNodeId = trimText(activeNodeId) && nodeById.has(trimText(activeNodeId))
      ? trimText(activeNodeId)
      : rootNode.id;
    const currentPathNodeIds = [];
    let cursor = nodeById.get(resolvedActiveNodeId) || null;
    while (cursor?.id) {
      if (cursor.id === rootNode.id) {
        if (cursor.id === resolvedActiveNodeId) {
          cursor.isCurrentPath = true;
          currentPathNodeIds.unshift(cursor.id);
        }
        break;
      }
      cursor.isCurrentPath = true;
      currentPathNodeIds.unshift(cursor.id);
      const parentId = trimText(cursor.parentNodeId);
      cursor = parentId ? (nodeById.get(parentId) || null) : null;
    }

    const activeNode = nodeById.get(resolvedActiveNodeId) || rootNode;
    activeNode.isCurrent = true;

    const questCounts = buildQuestNodeCounts(nextNodes);
    return {
      id: trimText(questId) || `quest:${normalizedRootSessionId}`,
      rootSessionId: normalizedRootSessionId,
      title: trimText(title) || trimText(rootNode.title) || "当前任务",
      summary: trimText(summary) || trimText(rootNode.summary),
      currentNodeId: activeNode.id,
      currentNodeTitle: trimText(activeNode.title) || trimText(rootNode.title) || "当前任务",
      currentPathNodeIds,
      nodeIds: nextNodes.map((node) => node.id),
      edgeIds: nextEdges.map((edge) => edge.id),
      nodes: nextNodes,
      edges: nextEdges,
      counts: questCounts,
    };
  }

  function questToGraphData(quest = {}) {
    return {
      questId: quest.id,
      rootSessionId: quest.rootSessionId,
      title: quest.title,
      summary: quest.summary,
      activeNodeId: quest.currentNodeId,
      nodes: (Array.isArray(quest.nodes) ? quest.nodes : []).map((node) => ({
        id: node.id,
        kind: node.kind,
        title: node.title,
        summary: node.summary,
        sessionId: node.sessionId,
        sourceSessionId: node.sourceSessionId,
        parentNodeId: node.parentNodeId,
        status: node.status,
        lineRole: node.lineRole,
        capabilities: Array.isArray(node.capabilities) ? [...node.capabilities] : [],
        surfaceBindings: Array.isArray(node.surfaceBindings) ? [...node.surfaceBindings] : [],
        view: node.view ? cloneJson(node.view) : null,
      })),
      edges: (Array.isArray(quest.edges) ? quest.edges : []).map((edge) => ({
        id: edge.id,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        type: edge.type,
      })),
    };
  }

  function mergePlanIntoQuest(existingQuest, plan) {
    const base = questToGraphData(existingQuest);
    const nodeIds = new Set(base.nodes.map((node) => node.id));
    const nodeIndexById = new Map(base.nodes.map((node, index) => [node.id, index]));
    const edgeIds = new Set(base.edges.map((edge) => edge.id || `edge:${edge.fromNodeId}:${edge.toNodeId}`));

    function mergePlanNode(existingNode, planNode) {
      const nextNode = {
        ...existingNode,
        kind: trimText(planNode.kind) || existingNode.kind,
        title: trimText(planNode.title) || existingNode.title,
        summary: trimText(planNode.summary) || existingNode.summary,
        sessionId: trimText(planNode.sessionId) || existingNode.sessionId,
        sourceSessionId: trimText(planNode.sourceSessionId) || existingNode.sourceSessionId,
        parentNodeId: trimText(planNode.parentNodeId) || existingNode.parentNodeId,
        status: trimText(planNode.status) || existingNode.status,
        lineRole: trimText(planNode.lineRole) || existingNode.lineRole,
      };
      if (Array.isArray(planNode.capabilities) && planNode.capabilities.length > 0) {
        nextNode.capabilities = [...planNode.capabilities];
      }
      if (Array.isArray(planNode.surfaceBindings) && planNode.surfaceBindings.length > 0) {
        nextNode.surfaceBindings = [...planNode.surfaceBindings];
      }
      if (planNode.view && typeof planNode.view === "object") {
        nextNode.view = cloneJson(planNode.view);
      }
      return nextNode;
    }

    for (const node of plan.nodes) {
      if (nodeIds.has(node.id)) {
        const index = nodeIndexById.get(node.id);
        if (Number.isInteger(index) && index >= 0) {
          base.nodes[index] = mergePlanNode(base.nodes[index], node);
        }
        continue;
      }
      nodeIds.add(node.id);
      nodeIndexById.set(node.id, base.nodes.length);
      base.nodes.push(node);
    }
    for (const edge of plan.edges) {
      const edgeId = trimText(edge.id) || `edge:${edge.fromNodeId}:${edge.toNodeId}`;
      if (edgeIds.has(edgeId)) continue;
      edgeIds.add(edgeId);
      base.edges.push(edge);
    }

    return buildQuestFromGraphData({
      ...base,
      title: trimText(plan.title) || base.title,
      summary: trimText(plan.summary) || base.summary,
      activeNodeId: trimText(plan.activeNodeId) || base.activeNodeId,
    });
  }

  function applyTaskMapPlansToProjection({ projection = null, snapshot = null } = {}) {
    if (!projection || typeof projection !== "object") return projection;
    const plans = normalizeTaskMapPlans(snapshot?.taskMapPlans);
    if (!plans.length) return projection;

    const nextProjection = {
      ...projection,
      mainQuests: Array.isArray(projection.mainQuests) ? [...projection.mainQuests] : [],
    };

    for (const plan of plans) {
      const questIndex = nextProjection.mainQuests.findIndex((quest) => (
        trimText(quest?.id) === plan.questId
        || trimText(quest?.rootSessionId) === plan.rootSessionId
      ));
      const nextQuest = plan.mode === "augment-default" && questIndex >= 0
        ? mergePlanIntoQuest(nextProjection.mainQuests[questIndex], plan)
        : buildQuestFromGraphData(plan);
      if (!nextQuest) continue;
      if (questIndex >= 0) {
        nextProjection.mainQuests[questIndex] = nextQuest;
      } else {
        nextProjection.mainQuests.push(nextQuest);
      }
    }

    return nextProjection;
  }

  window.MelodySyncTaskMapPlan = Object.freeze({
    normalizeTaskMapPlan,
    normalizeTaskMapPlans,
    buildQuestFromGraphData,
    applyTaskMapPlansToProjection,
  });
})();
