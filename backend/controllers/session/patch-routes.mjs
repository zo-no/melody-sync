import { applySessionHttpPatch } from '../../services/session/http-mutation-service.mjs';
import { readSessionPatchRequest } from './patch-request.mjs';
import { createClientSessionDetail } from '../../views/session/client.mjs';

export async function handleSessionPatchRoutes(ctx) {
  const { req, res, pathname, pathParts: parts, authSession, requireSessionAccess, writeJson } = ctx;
  if (!(pathname.startsWith('/api/sessions/') && req?.method === 'PATCH')) {
    return false;
  }
  const sessionId = parts[2];
  if (parts.length !== 3 || parts[0] !== 'api' || parts[1] !== 'sessions' || !sessionId) {
    writeJson(res, 400, { error: 'Invalid session path' });
    return true;
  }
  if (!requireSessionAccess(res, authSession, sessionId)) return true;

  try {
    const patch = await readSessionPatchRequest(req);
    const session = await applySessionHttpPatch(sessionId, patch);
    if (!session) {
      writeJson(res, 404, { error: 'Session not found' });
      return true;
    }
    writeJson(res, 200, { session: createClientSessionDetail(session) });
  } catch (error) {
    writeJson(res, error?.statusCode || 400, { error: error?.message || 'Bad request' });
  }
  return true;
}
