import {
  getSessionForClient,
  getSessionListItemForClient,
  listSessionListItemsForClient,
} from '../../services/session/client-session-service.mjs';
import { createClientSessionSummaryRef } from '../../views/session/client.mjs';

function getQueryStringValue(value) {
  return typeof value === 'string'
    ? String(value || '').trim()
    : '';
}

export async function handleSessionCatalogReadRoutes({
  req,
  res,
  parsedUrl,
  sessionGetRoute,
  authSession,
  requireSessionAccess,
  writeJsonCached,
  writeJson,
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
    const sessionRefs = targetSessions.map(createClientSessionSummaryRef).filter((ref) => ref?.id);
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

  return false;
}
