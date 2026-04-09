(function workbenchTaskMapMockPresetsModule() {
  const root = typeof globalThis === "object" && globalThis ? globalThis : window;

  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeText(value) {
    return trimText(value).replace(/\s+/g, " ");
  }

  function normalizeKey(value) {
    return normalizeText(value).toLowerCase();
  }

  function cloneJson(value) {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function getGraphModelApi() {
    return root?.MelodySyncWorkbenchGraphModel
      || root?.window?.MelodySyncWorkbenchGraphModel
      || null;
  }

  function getNodeEffectsApi() {
    return root?.MelodySyncWorkbenchNodeEffects
      || root?.window?.MelodySyncWorkbenchNodeEffects
      || null;
  }

  function withNodeKindEffect(node = {}) {
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

    const graphModel = getGraphModelApi();
    const graphCollections = graphModel?.hydrateQuestGraphCollections?.({
      questId: activeQuest.id,
      nodes: activeQuest.nodes,
      edges: activeQuest.edges,
    }) || null;
    const nodeById = graphCollections?.nodeById || new Map(activeQuest.nodes.filter((node) => node?.id).map((node) => [node.id, node]));
    const rootNodeId = `session:${activeQuest.rootSessionId || ""}`;
    const rootNode = nodeById.get(rootNodeId);
    if (!rootNode) return cloned;

    function appendNode(node) {
      const nextNode = graphCollections && graphModel
        ? graphModel.appendGraphNode(graphCollections, {
          childNodeIds: [],
          candidateNodeIds: [],
          isCurrent: false,
          isCurrentPath: false,
          ...node,
        })
        : withNodeKindEffect({
          childNodeIds: [],
          candidateNodeIds: [],
          isCurrent: false,
          isCurrentPath: false,
          ...node,
        });
      if (!nextNode) return null;
      activeQuest.nodeIds = Array.isArray(activeQuest.nodeIds) ? activeQuest.nodeIds : [];
      if (!activeQuest.nodeIds.includes(nextNode.id)) {
        activeQuest.nodes.push(nextNode);
        activeQuest.nodeIds.push(nextNode.id);
      }
      nodeById.set(nextNode.id, nextNode);
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

    if (graphCollections && graphModel) {
      const nextSnapshot = graphModel.buildQuestGraphSnapshot({
        collections: graphCollections,
        questId: activeQuest.id,
        rootSessionId: activeQuest.rootSessionId,
        title: activeQuest.title,
        summary: activeQuest.summary,
        currentNodeId: activeQuest.currentNodeId,
        currentNodeTitle: activeQuest.currentNodeTitle,
        currentPathNodeIds: Array.isArray(activeQuest.currentPathNodeIds) ? activeQuest.currentPathNodeIds : [],
      });
      Object.assign(activeQuest, nextSnapshot);
    } else {
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

  root.MelodySyncTaskMapMockPresets = Object.freeze({
    normalizeMockPresetName,
    applyTaskMapMockPreset,
  });
})();
