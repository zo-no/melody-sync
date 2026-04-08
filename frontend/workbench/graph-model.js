(function workbenchGraphModelModule() {
  const root = typeof globalThis === "object" && globalThis ? globalThis : window;

  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function getNodeEffectsApi() {
    return root?.MelodySyncWorkbenchNodeEffects
      || root?.window?.MelodySyncWorkbenchNodeEffects
      || null;
  }

  function getNodeInstanceApi() {
    return root?.MelodySyncWorkbenchNodeInstance
      || root?.window?.MelodySyncWorkbenchNodeInstance
      || null;
  }

  function withNodeKindEffect(node = {}) {
    const nextNode = getNodeEffectsApi()?.withNodeKindEffect?.(node);
    if (nextNode && typeof nextNode === "object") return nextNode;
    return {
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

  function createGraphNodeInstance(node = {}) {
    const nodeInstance = getNodeInstanceApi()?.createNodeInstance?.(node, {
      questId: trimText(node?.questId),
      origin: node?.origin || { type: "projection", sourceId: "continuity" },
    });
    if (nodeInstance && typeof nodeInstance === "object") return nodeInstance;
    return withNodeKindEffect({
      childNodeIds: Array.isArray(node?.childNodeIds) ? [...node.childNodeIds] : [],
      candidateNodeIds: Array.isArray(node?.candidateNodeIds) ? [...node.candidateNodeIds] : [],
      isCurrent: node?.isCurrent === true,
      isCurrentPath: node?.isCurrentPath === true,
      depth: Number.isFinite(node?.depth) ? node.depth : 0,
      ...node,
    });
  }

  function createGraphEdgeInstance(edge = {}, { questId = "" } = {}) {
    const fromNodeId = trimText(edge.fromNodeId || edge.from);
    const toNodeId = trimText(edge.toNodeId || edge.to);
    if (!fromNodeId || !toNodeId) return null;
    return {
      id: trimText(edge.id) || `edge:${fromNodeId}:${toNodeId}`,
      questId: trimText(edge.questId) || trimText(questId),
      fromNodeId,
      toNodeId,
      type: trimText(edge.type) || "structural",
    };
  }

  function createQuestGraphCollections({ questId = "" } = {}) {
    return {
      questId: trimText(questId),
      nodes: [],
      nodeById: new Map(),
      edges: [],
      edgeById: new Set(),
    };
  }

  function appendGraphEdge(collections, edge = {}) {
    if (!collections || typeof collections !== "object") return null;
    const nextEdge = createGraphEdgeInstance(edge, { questId: collections.questId });
    if (!nextEdge || collections.edgeById.has(nextEdge.id)) return null;
    collections.edgeById.add(nextEdge.id);
    collections.edges.push(nextEdge);
    return nextEdge;
  }

  function appendGraphNode(collections, node = {}) {
    if (!collections || typeof collections !== "object") return null;
    const nextNode = createGraphNodeInstance(node);
    const nodeId = trimText(nextNode?.id);
    if (!nodeId) return null;
    if (collections.nodeById.has(nodeId)) {
      return collections.nodeById.get(nodeId);
    }
    collections.nodes.push(nextNode);
    collections.nodeById.set(nodeId, nextNode);

    const parentNodeId = trimText(nextNode.parentNodeId);
    if (!parentNodeId) return nextNode;
    const parentNode = collections.nodeById.get(parentNodeId);
    if (!parentNode) return nextNode;
    parentNode.childNodeIds = Array.isArray(parentNode.childNodeIds) ? parentNode.childNodeIds : [];
    parentNode.candidateNodeIds = Array.isArray(parentNode.candidateNodeIds) ? parentNode.candidateNodeIds : [];
    if (!parentNode.childNodeIds.includes(nextNode.id)) {
      parentNode.childNodeIds.push(nextNode.id);
    }
    if (shouldTrackCandidateChild(nextNode) && !parentNode.candidateNodeIds.includes(nextNode.id)) {
      parentNode.candidateNodeIds.push(nextNode.id);
    }
    appendGraphEdge(collections, {
      id: `edge:${parentNode.id}:${nextNode.id}`,
      fromNodeId: parentNode.id,
      toNodeId: nextNode.id,
      type: nextNode?.kindEffect?.edgeVariant || "structural",
    });
    return nextNode;
  }

  function hydrateQuestGraphCollections({ questId = "", nodes = [], edges = [] } = {}) {
    const collections = createQuestGraphCollections({ questId });
    for (const node of Array.isArray(nodes) ? nodes : []) {
      const nextNode = createGraphNodeInstance(node);
      if (!nextNode?.id || collections.nodeById.has(nextNode.id)) continue;
      collections.nodes.push(nextNode);
      collections.nodeById.set(nextNode.id, nextNode);
    }
    for (const edge of Array.isArray(edges) ? edges : []) {
      appendGraphEdge(collections, edge);
    }
    return collections;
  }

  function buildQuestGraphSnapshot({
    collections = null,
    questId = "",
    rootSessionId = "",
    title = "",
    summary = "",
    currentNodeId = "",
    currentNodeTitle = "",
    currentPathNodeIds = null,
  } = {}) {
    const nodes = Array.isArray(collections?.nodes) ? collections.nodes : [];
    const edges = Array.isArray(collections?.edges) ? collections.edges : [];
    const nodeById = collections?.nodeById instanceof Map
      ? collections.nodeById
      : new Map(nodes.filter((node) => node?.id).map((node) => [node.id, node]));
    const normalizedRootSessionId = trimText(rootSessionId);
    const rootNodeId = normalizedRootSessionId ? `session:${normalizedRootSessionId}` : "";
    const resolvedActiveNode = nodeById.get(trimText(currentNodeId))
      || nodeById.get(rootNodeId)
      || nodes[0]
      || null;
    const resolvedCurrentPathNodeIds = Array.isArray(currentPathNodeIds)
      ? currentPathNodeIds.map((value) => trimText(value)).filter(Boolean)
      : nodes.filter((node) => node?.isCurrent || node?.isCurrentPath).map((node) => node.id);

    return {
      id: trimText(questId) || trimText(collections?.questId) || `quest:${normalizedRootSessionId}`,
      rootSessionId: normalizedRootSessionId,
      title: trimText(title) || trimText(resolvedActiveNode?.title) || "当前任务",
      summary: trimText(summary),
      currentNodeId: trimText(resolvedActiveNode?.id),
      currentNodeTitle: trimText(currentNodeTitle) || trimText(resolvedActiveNode?.title) || "当前任务",
      currentPathNodeIds: resolvedCurrentPathNodeIds,
      nodeIds: nodes.map((node) => node.id),
      edgeIds: edges.map((edge) => edge.id),
      nodes,
      edges,
      counts: buildQuestNodeCounts(nodes),
    };
  }

  root.MelodySyncWorkbenchGraphModel = Object.freeze({
    createGraphNodeInstance,
    createGraphEdgeInstance,
    createQuestGraphCollections,
    appendGraphNode,
    appendGraphEdge,
    hydrateQuestGraphCollections,
    buildQuestGraphSnapshot,
  });
})();
