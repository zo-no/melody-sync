import {
  getSessionCatalogDetailForClient,
  getSessionCatalogListForClient,
} from '../../services/session/catalog-read-service.mjs';

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
    const payload = await getSessionCatalogListForClient({
      sourceId: typeof parsedUrl?.query?.sourceId === 'string' ? parsedUrl.query.sourceId : '',
      folder: typeof parsedUrl?.query?.folder === 'string' ? parsedUrl.query.folder : '',
      archivedOnly: sessionGetRoute.kind === 'archived-list',
      refsOnly: view === 'refs',
    });
    writeJsonCached(req, res, payload);
    return true;
  }

  if (sessionGetRoute.kind === 'detail') {
    const { sessionId } = sessionGetRoute;
    if (!requireSessionAccess(res, authSession, sessionId)) return true;
    const view = getQueryStringValue(parsedUrl?.query?.view).toLowerCase();
    const session = await getSessionCatalogDetailForClient(sessionId, {
      summaryOnly: view === 'summary' || view === 'sidebar',
    });
    if (!session) {
      writeJson(res, 404, { error: 'Session not found' });
      return true;
    }
    writeJsonCached(req, res, { session });
    return true;
  }

  return false;
}
