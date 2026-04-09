import { readEventBody } from '../../history.mjs';
import { buildEventBlockEvents, buildSessionDisplayEvents } from '../../session/display-events.mjs';
import {
  getSessionEventsAfter,
  getSessionSourceContext,
  getSessionTimelineEvents,
} from '../../session/manager.mjs';
import { getSessionForClient } from '../../services/session/client-session-service.mjs';

const IMMUTABLE_PRIVATE_EVENT_CACHE_CONTROL = 'private, max-age=1296000, immutable';

function getQueryStringValue(value) {
  return typeof value === 'string'
    ? String(value || '').trim()
    : '';
}

export async function handleSessionEventReadRoutes({
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
      cacheControl: IMMUTABLE_PRIVATE_EVENT_CACHE_CONTROL,
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
      cacheControl: IMMUTABLE_PRIVATE_EVENT_CACHE_CONTROL,
      vary: '',
    });
    return true;
  }

  return false;
}
