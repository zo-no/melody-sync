import {
  deleteSessionForHttp,
  deleteAllArchivedSessionsForHttp,
} from '../../services/session/http-mutation-service.mjs';

export async function handleSessionDeleteRoutes(ctx) {
  const { req, res, pathname, pathParts: parts, authSession, requireSessionAccess, writeJson } = ctx;
  if (!(pathname.startsWith('/api/sessions') && req?.method === 'DELETE')) {
    return false;
  }

  // DELETE /api/sessions/archived/bulk — clear all archived sessions
  if (pathname === '/api/sessions/archived/bulk') {
    try {
      const outcome = await deleteAllArchivedSessionsForHttp();
      writeJson(res, 200, { deletedSessionIds: outcome?.deletedSessionIds || [] });
    } catch (error) {
      writeJson(res, error?.statusCode || 500, {
        error: error?.message || 'Failed to clear archived sessions',
      });
    }
    return true;
  }

  // DELETE /api/sessions/:id — delete a single session
  const sessionId = parts[2];
  if (parts.length !== 3 || parts[0] !== 'api' || parts[1] !== 'sessions' || !sessionId) {
    writeJson(res, 400, { error: 'Invalid session path' });
    return true;
  }
  if (!requireSessionAccess(res, authSession, sessionId)) return true;
  try {
    const outcome = await deleteSessionForHttp(sessionId);
    writeJson(res, 200, { deletedSessionIds: outcome?.deletedSessionIds || [] });
  } catch (error) {
    writeJson(res, error?.statusCode || 409, {
      error: error?.message || 'Failed to delete session',
    });
  }
  return true;
}
