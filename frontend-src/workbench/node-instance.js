(function workbenchNodeInstanceModule() {
  const root = typeof globalThis === "object" && globalThis ? globalThis : window;
  const FALLBACK_NODE_ORIGIN_TYPES = Object.freeze([
    "projection",
    "plan",
    "hook",
    "system",
    "manual",
    "unknown",
  ]);

  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function getNodeEffectsApi() {
    return root?.MelodySyncWorkbenchNodeEffects
      || root?.window?.MelodySyncWorkbenchNodeEffects
      || null;
  }

  function getNodeContractApi() {
    return root?.MelodySyncWorkbenchNodeContract
      || root?.window?.MelodySyncWorkbenchNodeContract
      || null;
  }

  function normalizeAllowedTokenList(values, allowlist, fallback = []) {
    const allowlistMap = new Map(
      (Array.isArray(allowlist) ? allowlist : []).map((value) => [trimText(value).toLowerCase(), value]),
    );
    if (!Array.isArray(values) || values.length === 0) return [...fallback];
    const normalized = values
      .map((value) => trimText(value).toLowerCase())
      .filter((value) => allowlistMap.has(value))
      .map((value) => allowlistMap.get(value));
    return normalized.length > 0 ? [...new Set(normalized)] : [...fallback];
  }

  function getTaskCardBindingKeys() {
    return getNodeContractApi()?.NODE_TASK_CARD_BINDING_KEYS
      || ["mainGoal", "goal", "candidateBranches", "summary", "checkpoint", "nextSteps"];
  }

  function normalizeNodeStatus(value) {
    return trimText(value).toLowerCase() || "active";
  }

  function normalizeNodeLineRole(value, node = {}) {
    const normalized = trimText(value).toLowerCase();
    if (normalized) return normalized;
    if (!trimText(node?.parentNodeId)) return "main";
    if (getNodeEffectsApi()?.shouldTrackCandidateChild?.(node) === true) return "candidate";
    return "branch";
  }

  function normalizeNodeOrigin(origin = null, fallback = {}) {
    const rawOrigin = origin && typeof origin === "object" ? origin : {};
    const fallbackOrigin = fallback && typeof fallback === "object" ? fallback : {};
    const originType = trimText(rawOrigin.type || fallbackOrigin.type).toLowerCase();
    const sourceId = trimText(rawOrigin.sourceId || fallbackOrigin.sourceId);
    const sourceLabel = trimText(rawOrigin.sourceLabel || fallbackOrigin.sourceLabel);
    const hookId = trimText(rawOrigin.hookId || fallbackOrigin.hookId);
    const planId = trimText(rawOrigin.planId || fallbackOrigin.planId);
    if (!originType && !sourceId && !sourceLabel && !hookId && !planId) {
      return null;
    }
    return {
      type: FALLBACK_NODE_ORIGIN_TYPES.includes(originType) ? originType : "unknown",
      sourceId,
      sourceLabel,
      hookId,
      planId,
    };
  }

  function cloneJson(value) {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function resolveNodeSourceSessionId(node = {}) {
    return trimText(node?.sourceSessionId || node?.sessionId);
  }

  function createNodeInstance(node = {}, { questId = "", origin = null } = {}) {
    const nodeEffectsApi = getNodeEffectsApi();
    const kind = trimText(node?.kind).toLowerCase();
    const nextNode = {
      id: trimText(node?.id),
      questId: trimText(node?.questId || questId),
      kind,
      title: trimText(node?.title || node?.id),
      summary: trimText(node?.summary),
      sessionId: trimText(node?.sessionId),
      sourceSessionId: resolveNodeSourceSessionId(node),
      parentNodeId: trimText(node?.parentNodeId || node?.parentId),
      status: normalizeNodeStatus(node?.status),
      lineRole: normalizeNodeLineRole(node?.lineRole, node),
      depth: Number.isFinite(node?.depth) ? node.depth : 0,
      childNodeIds: Array.isArray(node?.childNodeIds) ? [...node.childNodeIds] : [],
      candidateNodeIds: Array.isArray(node?.candidateNodeIds) ? [...node.candidateNodeIds] : [],
      isCurrent: node?.isCurrent === true,
      isCurrentPath: node?.isCurrentPath === true,
      conclusionText: trimText(node?.conclusionText),
      capabilities: nodeEffectsApi?.getNodeCapabilities?.(node) || [],
      surfaceBindings: nodeEffectsApi?.getNodeSurfaceBindings?.(node) || ["task-map"],
      taskCardBindings: nodeEffectsApi?.getNodeTaskCardBindings?.(node) || [],
      view: nodeEffectsApi?.getNodeView?.(node) || null,
      origin: normalizeNodeOrigin(node?.origin, origin),
    };
    return nodeEffectsApi?.withNodeKindEffect?.(nextNode) || {
      ...nextNode,
      kindEffect: nodeEffectsApi?.getNodeEffect?.(nextNode) || null,
    };
  }

  function cloneNodeInstance(node = {}) {
    return createNodeInstance({
      ...node,
      childNodeIds: Array.isArray(node?.childNodeIds) ? [...node.childNodeIds] : [],
      candidateNodeIds: Array.isArray(node?.candidateNodeIds) ? [...node.candidateNodeIds] : [],
      capabilities: Array.isArray(node?.capabilities) ? [...node.capabilities] : [],
      surfaceBindings: Array.isArray(node?.surfaceBindings) ? [...node.surfaceBindings] : [],
      taskCardBindings: Array.isArray(node?.taskCardBindings) ? [...node.taskCardBindings] : [],
      view: node?.view ? cloneJson(node.view) : null,
      origin: node?.origin ? { ...node.origin } : null,
    }, {
      questId: node?.questId,
      origin: node?.origin,
    });
  }

  function mergeNodeInstances(existingNode = {}, patchNode = {}, { origin = null } = {}) {
    return createNodeInstance({
      ...existingNode,
      ...patchNode,
      kind: trimText(patchNode?.kind) || trimText(existingNode?.kind),
      title: trimText(patchNode?.title) || trimText(existingNode?.title),
      summary: trimText(patchNode?.summary) || trimText(existingNode?.summary),
      sessionId: trimText(patchNode?.sessionId) || trimText(existingNode?.sessionId),
      sourceSessionId: trimText(patchNode?.sourceSessionId) || trimText(existingNode?.sourceSessionId),
      parentNodeId: trimText(patchNode?.parentNodeId || patchNode?.parentId) || trimText(existingNode?.parentNodeId),
      status: trimText(patchNode?.status) || trimText(existingNode?.status),
      lineRole: trimText(patchNode?.lineRole) || trimText(existingNode?.lineRole),
      childNodeIds: Array.isArray(existingNode?.childNodeIds) ? [...existingNode.childNodeIds] : [],
      candidateNodeIds: Array.isArray(existingNode?.candidateNodeIds) ? [...existingNode.candidateNodeIds] : [],
      capabilities: Array.isArray(patchNode?.capabilities) && patchNode.capabilities.length > 0
        ? [...patchNode.capabilities]
        : (Array.isArray(existingNode?.capabilities) ? [...existingNode.capabilities] : []),
      surfaceBindings: Array.isArray(patchNode?.surfaceBindings) && patchNode.surfaceBindings.length > 0
        ? [...patchNode.surfaceBindings]
        : (Array.isArray(existingNode?.surfaceBindings) ? [...existingNode.surfaceBindings] : []),
      taskCardBindings: Array.isArray(patchNode?.taskCardBindings) && patchNode.taskCardBindings.length > 0
        ? [...patchNode.taskCardBindings]
        : (Array.isArray(existingNode?.taskCardBindings) ? [...existingNode.taskCardBindings] : []),
      view: patchNode?.view && typeof patchNode.view === "object"
        ? cloneJson(patchNode.view)
        : (existingNode?.view ? cloneJson(existingNode.view) : null),
      origin: patchNode?.origin || existingNode?.origin || origin || null,
    }, {
      questId: trimText(patchNode?.questId || existingNode?.questId),
      origin: patchNode?.origin || existingNode?.origin || origin || null,
    });
  }

  function hasSurfaceBinding(node = {}, surfaceSlot = "") {
    const normalizedSurfaceSlot = trimText(surfaceSlot).toLowerCase();
    if (!normalizedSurfaceSlot) return false;
    const surfaceBindings = normalizeAllowedTokenList(
      node?.surfaceBindings,
      getNodeContractApi()?.NODE_SURFACE_SLOTS || ["task-map", "composer-suggestions"],
      [],
    );
    return surfaceBindings.includes(normalizedSurfaceSlot);
  }

  function buildComposerSuggestionEntry(node = {}) {
    const nodeInstance = createNodeInstance(node, { origin: node?.origin || null });
    if (!trimText(nodeInstance.title)) return null;
    return {
      id: trimText(nodeInstance.id),
      text: trimText(nodeInstance.title),
      summary: trimText(nodeInstance.summary),
      capabilities: Array.isArray(nodeInstance.capabilities) ? [...nodeInstance.capabilities] : [],
      sourceSessionId: resolveNodeSourceSessionId(nodeInstance),
      taskCardBindings: normalizeAllowedTokenList(
        nodeInstance.taskCardBindings,
        getTaskCardBindingKeys(),
        [],
      ),
      origin: nodeInstance.origin ? { ...nodeInstance.origin } : null,
    };
  }

  root.MelodySyncWorkbenchNodeInstance = Object.freeze({
    NODE_ORIGIN_TYPES: FALLBACK_NODE_ORIGIN_TYPES,
    normalizeNodeStatus,
    normalizeNodeLineRole,
    normalizeNodeOrigin,
    resolveNodeSourceSessionId,
    createNodeInstance,
    cloneNodeInstance,
    mergeNodeInstances,
    hasSurfaceBinding,
    buildComposerSuggestionEntry,
  });
})();
