import { resolveSessionStateFromSession } from './session-state.mjs';

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
  cloned.sessionState = sessionState;
  return cloned;
}

export function createSessionListItem(session) {
  return stripSessionShape(session, { includeQueuedMessages: false });
}

export function createSessionDetail(session) {
  return stripSessionShape(session, { includeQueuedMessages: true });
}
