function getQueryStringValue(value) {
  return typeof value === 'string'
    ? String(value || '').trim()
    : '';
}

export async function handleSessionReadRoutes({
  req,
  res,
  parsedUrl,
  sessionGetRoute,
  authSession,
  requireSessionAccess,
  listSessionListItemsForClient,
  createSessionSummaryRef,
  writeJsonCached,
  writeJson,
  getSessionListItemForClient,
  getSessionForClient,
  getSessionEventsAfter,
  getSessionTimelineEvents,
  buildSessionDisplayEvents,
  getSessionSourceContext,
  buildEventBlockEvents,
  readEventBody,
  immutablePrivateEventCacheControl,
} = {}) {
  if (!sessionGetRoute || req?.method !== 'GET') {
    return false;
  }

  if (sessionGetRoute.kind === 'list' || sessionGetRoute.kind === 'archived-list') {
    const view = getQueryStringValue(parsedUrl?.query?.view).toLowerCase();
    const sessionList = await listSessionListItemsForClient({
      includeArchived: true,
      sourceId: typeof parsedUrl?.query?.sourceId === 'string' ? parsedUrl.query.sourceId : '',
    });
    const folderFilter = parsedUrl?.query?.folder;
    const filtered = folderFilter
      ? sessionList.filter((session) => session.folder === folderFilter)
      : sessionList;
    const archivedSessions = filtered.filter((session) => session?.archived === true);
    const activeSessions = filtered.filter((session) => session?.archived !== true);
    const targetSessions = sessionGetRoute.kind === 'archived-list'
      ? archivedSessions
      : activeSessions;
    const sessionRefs = targetSessions.map(createSessionSummaryRef).filter((ref) => ref?.id);
    if (view === 'refs') {
      writeJsonCached(req, res, {
        sessionRefs,
        archivedCount: archivedSessions.length,
      });
      return true;
    }
    writeJsonCached(req, res, {
      sessions: targetSessions,
      archivedCount: archivedSessions.length,
    });
    return true;
  }

  if (sessionGetRoute.kind === 'detail') {
    const { sessionId } = sessionGetRoute;
    if (!requireSessionAccess(res, authSession, sessionId)) return true;
    const view = getQueryStringValue(parsedUrl?.query?.view).toLowerCase();
    const session = view === 'summary' || view === 'sidebar'
      ? await getSessionListItemForClient(sessionId)
      : await getSessionForClient(sessionId, { includeQueuedMessages: true });
    if (!session) {
      writeJson(res, 404, { error: 'Session not found' });
      return true;
    }
    writeJsonCached(req, res, { session });
    return true;
  }

  if (sessionGetRoute.kind === 'events') {
    const { sessionId } = sessionGetRoute;
    if (!requireSessionAccess(res, authSession, sessionId)) return true;
    const filter = getQueryStringValue(parsedUrl?.query?.filter).toLowerCase();
    if (filter === 'all') {
      const events = await getSessionEventsAfter(sessionId, 0);
      writeJsonCached(req, res, { sessionId, filter: 'all', events });
      return true;
    }
    const session = await getSessionForClient(sessionId);
    if (!session) {
      writeJson(res, 404, { error: 'Session not found' });
      return true;
    }
    const timeline = await getSessionTimelineEvents(sessionId);
    const events = buildSessionDisplayEvents(timeline, {
      sessionRunning: session?.activity?.run?.state === 'running',
    });
    writeJsonCached(req, res, { sessionId, filter: 'visible', events });
    return true;
  }

  if (sessionGetRoute.kind === 'source-context') {
    const { sessionId } = sessionGetRoute;
    if (!requireSessionAccess(res, authSession, sessionId)) return true;
    const sourceContext = await getSessionSourceContext(sessionId, {
      requestId: typeof parsedUrl?.query?.requestId === 'string' ? parsedUrl.query.requestId : '',
    });
    if (!sourceContext) {
      writeJson(res, 404, { error: 'Session not found' });
      return true;
    }
    writeJson(res, 200, { sessionId, sourceContext });
    return true;
  }

  if (sessionGetRoute.kind === 'event-block') {
    const {
      sessionId,
      startSeq,
      endSeq,
    } = sessionGetRoute;
    if (!requireSessionAccess(res, authSession, sessionId)) return true;
    const session = await getSessionForClient(sessionId);
    if (!session) {
      writeJson(res, 404, { error: 'Session not found' });
      return true;
    }
    const timeline = await getSessionTimelineEvents(sessionId);
    const events = buildEventBlockEvents(timeline, startSeq, endSeq);
    if (events.length === 0) {
      writeJson(res, 404, { error: 'Event block not found' });
      return true;
    }
    writeJsonCached(req, res, { sessionId, startSeq, endSeq, events }, {
      cacheControl: immutablePrivateEventCacheControl,
      vary: '',
    });
    return true;
  }

  if (sessionGetRoute.kind === 'event-body') {
    const { sessionId, seq } = sessionGetRoute;
    if (!requireSessionAccess(res, authSession, sessionId)) return true;
    const body = await readEventBody(sessionId, seq);
    if (!body) {
      writeJson(res, 404, { error: 'Event body not found' });
      return true;
    }
    writeJsonCached(req, res, { body }, {
      cacheControl: immutablePrivateEventCacheControl,
      vary: '',
    });
    return true;
  }

  return false;
}
