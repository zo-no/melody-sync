import { deleteSessionPermanently } from '../../session/manager.mjs';

export async function handleSessionDeleteRoutes({
  req,
  res,
  pathname,
  authSession,
  requireSessionAccess,
  writeJson,
} = {}) {
  if (!(pathname.startsWith('/api/sessions/') && req?.method === 'DELETE')) {
    return false;
  }

  const parts = pathname.split('/').filter(Boolean);
  const sessionId = parts[2];
  if (parts.length !== 3 || parts[0] !== 'api' || parts[1] !== 'sessions' || !sessionId) {
    writeJson(res, 400, { error: 'Invalid session path' });
    return true;
  }
  if (!requireSessionAccess(res, authSession, sessionId)) return true;
  try {
    const outcome = await deleteSessionPermanently(sessionId);
    writeJson(res, 200, { deletedSessionIds: outcome?.deletedSessionIds || [] });
  } catch (error) {
    writeJson(res, error?.statusCode || 409, {
      error: error?.message || 'Failed to delete session',
    });
  }
  return true;
}
