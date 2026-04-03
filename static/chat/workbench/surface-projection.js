(function workbenchSurfaceProjectionModule() {
  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function getTaskMapPlanApi() {
    return globalThis?.MelodySyncTaskMapPlan
      || globalThis?.window?.MelodySyncTaskMapPlan
      || null;
  }

  function getWorkbenchApi() {
    return globalThis?.MelodySyncWorkbench
      || globalThis?.window?.MelodySyncWorkbench
      || null;
  }

  function getNodeInstanceApi() {
    return globalThis?.MelodySyncWorkbenchNodeInstance
      || globalThis?.window?.MelodySyncWorkbenchNodeInstance
      || null;
  }

  function resolveSourceSessionId(session = null) {
    return trimText(session?.id);
  }

  function resolveRootSessionId(session = null) {
    return trimText(session?.rootSessionId) || resolveSourceSessionId(session);
  }

  function resolveTaskMapProjection(projection = null) {
    if (projection && typeof projection === "object") return projection;
    return getWorkbenchApi()?.getTaskMapProjection?.() || null;
  }

  function collectSurfaceNodesForSession({
    session = null,
    surfaceSlot = "",
    projection = null,
  } = {}) {
    const resolvedProjection = resolveTaskMapProjection(projection);
    if (!resolvedProjection || typeof resolvedProjection !== "object") return [];
    const sourceSessionId = resolveSourceSessionId(session);
    const rootSessionId = resolveRootSessionId(session);
    if (!sourceSessionId || !rootSessionId) return [];
    return getTaskMapPlanApi()?.collectSurfaceNodes?.({
      projection: resolvedProjection,
      rootSessionId,
      sourceSessionId,
      surfaceSlot,
    }) || [];
  }

  function buildComposerSuggestionEntries({
    session = null,
    projection = null,
  } = {}) {
    return collectSurfaceNodesForSession({
      session,
      projection,
      surfaceSlot: "composer-suggestions",
    })
      .map((node) => (
        getNodeInstanceApi()?.buildComposerSuggestionEntry?.(node)
        || {
          id: trimText(node?.id),
          text: trimText(node?.title),
          summary: trimText(node?.summary),
          capabilities: Array.isArray(node?.capabilities) ? [...node.capabilities] : [],
          sourceSessionId: trimText(node?.sourceSessionId || node?.sessionId),
          taskCardBindings: Array.isArray(node?.taskCardBindings) ? [...node.taskCardBindings] : [],
          origin: node?.origin && typeof node.origin === "object" ? { ...node.origin } : null,
        }
      ))
      .filter((entry) => entry.text);
  }

  window.MelodySyncWorkbenchSurfaceProjection = Object.freeze({
    collectSurfaceNodesForSession,
    buildComposerSuggestionEntries,
  });
})();
