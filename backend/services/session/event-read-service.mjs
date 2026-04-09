import { buildEventBlockEvents, buildSessionDisplayEvents } from '../../session/display-events.mjs';
import {
  getSessionEventsAfter,
  getSessionSourceContext,
  getSessionTimelineEvents,
} from '../../session/manager.mjs';
import { getSessionForClient } from './client-session-service.mjs';

export async function listSessionRawEvents(sessionId) {
  return getSessionEventsAfter(sessionId, 0);
}

export async function listSessionVisibleEvents(sessionId) {
  const session = await getSessionForClient(sessionId);
  if (!session) return null;
  const timeline = await getSessionTimelineEvents(sessionId);
  return buildSessionDisplayEvents(timeline, {
    sessionRunning: session?.activity?.run?.state === 'running',
  });
}

export async function getSessionEventBlock(sessionId, startSeq, endSeq) {
  const session = await getSessionForClient(sessionId);
  if (!session) return null;
  const timeline = await getSessionTimelineEvents(sessionId);
  return buildEventBlockEvents(timeline, startSeq, endSeq);
}

export async function getSessionSourceContextForClient(sessionId, options = {}) {
  return getSessionSourceContext(sessionId, options);
}
