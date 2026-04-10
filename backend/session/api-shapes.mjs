import { resolveSessionStateFromSession } from '../session-runtime/session-state.mjs';
import { projectTaskCardFromSessionState } from './task-card.mjs';
import { normalizeTaskPoolMembership } from './task-pool-membership.mjs';

function cloneJson(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function stripSessionShape(session, {
  includeQueuedMessages = false,
} = {}) {
  if (!session || typeof session !== 'object') return null;
  const sessionState = resolveSessionStateFromSession(session, session?.sourceContext || null);
  const cloned = cloneJson(session);
  delete cloned.board;
  delete cloned.task;
  delete cloned.sourceContext;
  delete cloned.scheduledTriggers;
  delete cloned.scheduledTrigger;
  if (!includeQueuedMessages) {
    delete cloned.queuedMessages;
  }
  const normalizedTaskPoolMembership = normalizeTaskPoolMembership(cloned.taskPoolMembership, {
    sessionId: cloned?.id || '',
  });
  if (normalizedTaskPoolMembership) {
    cloned.taskPoolMembership = normalizedTaskPoolMembership;
  } else if (cloned.taskPoolMembership) {
    delete cloned.taskPoolMembership;
  }
  cloned.sessionState = sessionState;
  if (!cloned.taskCard || typeof cloned.taskCard !== 'object') {
    const projectedTaskCard = projectTaskCardFromSessionState(sessionState, {
      sessionTitle: cloned.name || '',
    });
    if (projectedTaskCard) {
      cloned.taskCard = projectedTaskCard;
    }
  }
  return cloned;
}

export function createSessionListItem(session) {
  return stripSessionShape(session, { includeQueuedMessages: false });
}

export function createSessionDetail(session) {
  return stripSessionShape(session, { includeQueuedMessages: true });
}
