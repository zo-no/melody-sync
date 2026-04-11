import { readSessionMessagePayload } from './message-request.mjs';
import {
  readCreateSessionRequest,
  readSessionDelegateRequest,
  readSessionOrganizeRequest,
  readSessionPersistentRequest,
} from './post-request.mjs';
import {
  cancelSessionRunForHttp,
  createSessionForHttp,
  delegateSessionForHttp,
  forkSessionForHttp,
  organizeSessionForHttp,
  promoteSessionPersistentForHttp,
  runSessionPersistentForHttp,
} from '../../services/session/http-post-service.mjs';
import { submitSessionHttpMessageForClient } from '../../services/session/http-message-service.mjs';
import { createClientSessionDetail } from '../../views/session/client.mjs';

export async function handleSessionPostRoutes({
  req,
  res,
  pathname,
  authSession,
  requireSessionAccess,
  writeJson,
} = {}) {
  if (pathname.startsWith('/api/sessions/') && req?.method === 'POST') {
    const parts = pathname.split('/').filter(Boolean);
    const sessionId = parts[2];
    const action = parts[3] || null;

    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'sessions' && sessionId && action === 'organize') {
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      try {
        const payload = await readSessionOrganizeRequest(req);
        const outcome = await organizeSessionForHttp(sessionId, payload);
        writeJson(res, outcome.duplicate ? 200 : 202, {
          duplicate: outcome.duplicate,
          run: outcome.run || null,
          session: createClientSessionDetail(outcome.session),
        });
      } catch (error) {
        writeJson(res, error?.statusCode || 409, { error: error.message || 'Failed to organize session' });
      }
      return true;
    }

    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'sessions' && sessionId && action === 'promote-persistent') {
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      try {
        const payload = await readSessionPersistentRequest(req);
        if (typeof payload?.kind !== 'string' || !payload.kind.trim()) {
          writeJson(res, 400, { error: 'kind is required' });
          return true;
        }
        const session = await promoteSessionPersistentForHttp(sessionId, payload);
        if (!session) {
          writeJson(res, 404, { error: 'Session not found' });
          return true;
        }
        writeJson(res, 200, { session: createClientSessionDetail(session) });
      } catch (error) {
        writeJson(res, error?.statusCode || 409, { error: error.message || 'Failed to promote session' });
      }
      return true;
    }

    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'sessions' && sessionId && action === 'run-persistent') {
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      try {
        const payload = await readSessionPersistentRequest(req);
        const outcome = await runSessionPersistentForHttp(sessionId, payload);
        if (!outcome?.session) {
          writeJson(res, 404, { error: 'Session not found' });
          return true;
        }
        writeJson(res, 202, {
          duplicate: outcome.duplicate,
          queued: outcome.queued,
          run: outcome.run || null,
          session: createClientSessionDetail(outcome.session),
          ...(outcome.parentSession ? { parentSession: createClientSessionDetail(outcome.parentSession) } : {}),
          ...(outcome.spawnedSession ? { spawnedSession: createClientSessionDetail(outcome.spawnedSession) } : {}),
        });
      } catch (error) {
        writeJson(res, error?.statusCode || 409, { error: error.message || 'Failed to run persistent session' });
      }
      return true;
    }

    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'sessions' && sessionId && action === 'messages') {
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      let payload;
      try {
        payload = await readSessionMessagePayload(req, pathname);
      } catch (error) {
        writeJson(res, error.code === 'BODY_TOO_LARGE' ? 413 : 400, {
          error: error.code === 'BODY_TOO_LARGE' ? 'Request body too large' : 'Bad request',
        });
        return true;
      }
      if (!payload || typeof payload !== 'object') {
        writeJson(res, 400, { error: 'Invalid request body' });
        return true;
      }
      if (!payload?.text || typeof payload.text !== 'string') {
        writeJson(res, 400, { error: 'text is required' });
        return true;
      }

      try {
        const { requestId, outcome } = await submitSessionHttpMessageForClient({
          sessionId,
          payload,
          authSession,
          hasSessionAccess: (nextAuthSession, targetSessionId) => !!nextAuthSession && !!targetSessionId,
        });
        writeJson(res, outcome.duplicate ? 200 : 202, {
          requestId: requestId || outcome.run?.requestId || null,
          duplicate: outcome.duplicate,
          queued: outcome.queued,
          run: outcome.run,
          session: createClientSessionDetail(outcome.session),
        });
      } catch (error) {
        const statusCode = error?.statusCode || (error?.code === 'SESSION_ARCHIVED' ? 409 : 400);
        writeJson(res, statusCode, { error: error.message || 'Failed to submit message' });
      }
      return true;
    }

    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'sessions' && sessionId && action === 'cancel') {
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      const outcome = await cancelSessionRunForHttp(sessionId);
      if (outcome.kind === 'missing_active_run') {
        writeJson(res, 409, { error: 'No active run' });
        return true;
      }
      writeJson(res, 200, {
        run: outcome.run,
        ...(outcome.session ? { session: createClientSessionDetail(outcome.session) } : {}),
      });
      return true;
    }

    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'sessions' && sessionId && action === 'fork') {
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      const outcome = await forkSessionForHttp(sessionId);
      if (outcome.kind === 'not_found') {
        writeJson(res, 404, { error: 'Session not found' });
        return true;
      }
      if (outcome.kind === 'running') {
        writeJson(res, 409, { error: 'Session is running' });
        return true;
      }
      if (!outcome.session) {
        writeJson(res, 409, { error: 'Unable to fork session' });
        return true;
      }
      writeJson(res, 201, { session: createClientSessionDetail(outcome.session) });
      return true;
    }

    if (parts.length === 4 && parts[0] === 'api' && parts[1] === 'sessions' && sessionId && action === 'delegate') {
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      try {
        const payload = await readSessionDelegateRequest(req);
        const outcome = await delegateSessionForHttp(sessionId, payload);
        if (outcome.kind === 'not_found') {
          writeJson(res, 404, { error: 'Session not found' });
          return true;
        }
        if (!outcome.session) {
          writeJson(res, 409, { error: 'Unable to delegate session' });
          return true;
        }
        writeJson(res, 201, {
          session: createClientSessionDetail(outcome.session),
          run: outcome.run || null,
        });
      } catch (error) {
        writeJson(res, error?.statusCode || 400, { error: error.message || 'Failed to delegate session' });
      }
      return true;
    }
  }

  if (pathname === '/api/sessions' && req?.method === 'POST') {
    try {
      const payload = await readCreateSessionRequest(req);
      const session = await createSessionForHttp(payload);
      writeJson(res, 201, { session: createClientSessionDetail(session) });
    } catch (error) {
      writeJson(res, error?.statusCode || 400, { error: error?.message || 'Invalid request body' });
    }
    return true;
  }

  return false;
}
