(function workbenchSurfaceProjectionModule() {
  const surfaceEntryCache = new Map();
  const surfaceEntryInflight = new Map();

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

  function getFetchJson() {
    return globalThis?.fetchJsonOrRedirect
      || globalThis?.window?.fetchJsonOrRedirect
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

  function buildSurfaceCacheKey(session = null, surfaceSlot = "") {
    const sourceSessionId = resolveSourceSessionId(session);
    const rootSessionId = resolveRootSessionId(session);
    const normalizedSurfaceSlot = trimText(surfaceSlot).toLowerCase();
    if (!sourceSessionId || !rootSessionId || !normalizedSurfaceSlot) return "";
    return `${rootSessionId}::${sourceSessionId}::${normalizedSurfaceSlot}`;
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

  function readCachedSurfaceEntries({
    session = null,
    surfaceSlot = "",
  } = {}) {
    const cacheKey = buildSurfaceCacheKey(session, surfaceSlot);
    if (!cacheKey) return [];
    const cached = surfaceEntryCache.get(cacheKey);
    return Array.isArray(cached?.entries) ? cached.entries.map((entry) => ({
      ...entry,
      origin: entry?.origin && typeof entry.origin === "object" ? { ...entry.origin } : null,
      capabilities: Array.isArray(entry?.capabilities) ? [...entry.capabilities] : [],
      taskCardBindings: Array.isArray(entry?.taskCardBindings) ? [...entry.taskCardBindings] : [],
    })) : [];
  }

  async function prefetchSurfaceEntriesForSession({
    session = null,
    surfaceSlot = "",
    force = false,
  } = {}) {
    const cacheKey = buildSurfaceCacheKey(session, surfaceSlot);
    if (!cacheKey) return [];
    if (!force) {
      const cachedEntries = readCachedSurfaceEntries({ session, surfaceSlot });
      if (cachedEntries.length > 0) return cachedEntries;
    }
    if (surfaceEntryInflight.has(cacheKey)) {
      return surfaceEntryInflight.get(cacheKey);
    }

    const fetchJson = getFetchJson();
    const sourceSessionId = resolveSourceSessionId(session);
    const normalizedSurfaceSlot = trimText(surfaceSlot).toLowerCase();
    const localFallbackEntries = buildComposerSuggestionEntries({
      session,
      surfaceSlot: normalizedSurfaceSlot,
      preferCache: false,
    });
    if (!sourceSessionId || typeof fetchJson !== "function") {
      return localFallbackEntries;
    }

    const inflight = (async () => {
      try {
        const response = await fetchJson(
          `/api/workbench/sessions/${encodeURIComponent(sourceSessionId)}/task-map-surfaces/${encodeURIComponent(normalizedSurfaceSlot)}`,
        );
        const entries = Array.isArray(response?.entries) ? response.entries : [];
        surfaceEntryCache.set(cacheKey, {
          rootSessionId: trimText(response?.rootSessionId || resolveRootSessionId(session)),
          surfaceSlot: normalizedSurfaceSlot,
          entries: entries.map((entry) => ({
            ...entry,
            origin: entry?.origin && typeof entry.origin === "object" ? { ...entry.origin } : null,
            capabilities: Array.isArray(entry?.capabilities) ? [...entry.capabilities] : [],
            taskCardBindings: Array.isArray(entry?.taskCardBindings) ? [...entry.taskCardBindings] : [],
          })),
        });
      } catch {
        if (!surfaceEntryCache.has(cacheKey)) {
          surfaceEntryCache.set(cacheKey, {
            rootSessionId: resolveRootSessionId(session),
            surfaceSlot: normalizedSurfaceSlot,
            entries: localFallbackEntries,
          });
        }
      } finally {
        surfaceEntryInflight.delete(cacheKey);
      }
      return readCachedSurfaceEntries({ session, surfaceSlot: normalizedSurfaceSlot });
    })();

    surfaceEntryInflight.set(cacheKey, inflight);
    return inflight;
  }

  function invalidateSurfaceEntriesForSession({
    session = null,
    surfaceSlot = "",
  } = {}) {
    const normalizedSurfaceSlot = trimText(surfaceSlot).toLowerCase();
    const cacheKey = buildSurfaceCacheKey(session, normalizedSurfaceSlot);
    if (cacheKey) {
      surfaceEntryCache.delete(cacheKey);
      surfaceEntryInflight.delete(cacheKey);
      return;
    }
    const sourceSessionId = resolveSourceSessionId(session);
    const rootSessionId = resolveRootSessionId(session);
    if (!sourceSessionId && !rootSessionId && !normalizedSurfaceSlot) {
      surfaceEntryCache.clear();
      surfaceEntryInflight.clear();
      return;
    }
    for (const key of [...surfaceEntryCache.keys()]) {
      const [cachedRootSessionId, cachedSourceSessionId, cachedSurfaceSlot] = key.split("::");
      if (rootSessionId && cachedRootSessionId !== rootSessionId) continue;
      if (sourceSessionId && cachedSourceSessionId !== sourceSessionId) continue;
      if (normalizedSurfaceSlot && cachedSurfaceSlot !== normalizedSurfaceSlot) continue;
      surfaceEntryCache.delete(key);
    }
    for (const key of [...surfaceEntryInflight.keys()]) {
      const [cachedRootSessionId, cachedSourceSessionId, cachedSurfaceSlot] = key.split("::");
      if (rootSessionId && cachedRootSessionId !== rootSessionId) continue;
      if (sourceSessionId && cachedSourceSessionId !== sourceSessionId) continue;
      if (normalizedSurfaceSlot && cachedSurfaceSlot !== normalizedSurfaceSlot) continue;
      surfaceEntryInflight.delete(key);
    }
  }

  function buildComposerSuggestionEntries({
    session = null,
    projection = null,
    surfaceSlot = "composer-suggestions",
    preferCache = true,
  } = {}) {
    const normalizedSurfaceSlot = trimText(surfaceSlot).toLowerCase() || "composer-suggestions";
    const cachedEntries = preferCache
      ? readCachedSurfaceEntries({ session, surfaceSlot: normalizedSurfaceSlot })
      : [];
    if (cachedEntries.length > 0) {
      return cachedEntries;
    }
    return collectSurfaceNodesForSession({
      session,
      projection,
      surfaceSlot: normalizedSurfaceSlot,
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
    prefetchSurfaceEntriesForSession,
    invalidateSurfaceEntriesForSession,
  });
})();
