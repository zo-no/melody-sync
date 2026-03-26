import {
  getPrimaryScheduledTrigger,
  normalizeScheduledTriggers,
} from './scheduled-trigger-utils.mjs';

function cloneJson(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function projectScheduledTriggerShape(session) {
  if (!session || typeof session !== 'object') return session;
  const triggers = normalizeScheduledTriggers(
    session.scheduledTriggers || session.scheduledTrigger,
    { preserveRuntimeState: true },
  );
  if (triggers.length > 0) {
    session.scheduledTriggers = triggers;
    session.scheduledTrigger = getPrimaryScheduledTrigger(triggers);
  } else {
    delete session.scheduledTriggers;
    delete session.scheduledTrigger;
  }
  return session;
}

function stripSessionShape(session, {
  includeQueuedMessages = false,
} = {}) {
  if (!session || typeof session !== 'object') return null;
  const cloned = projectScheduledTriggerShape(cloneJson(session));
  delete cloned.board;
  delete cloned.task;
  delete cloned.sourceContext;
  if (!includeQueuedMessages) {
    delete cloned.queuedMessages;
  }
  return cloned;
}

export function createSessionListItem(session) {
  return stripSessionShape(session, { includeQueuedMessages: false });
}

export function createSessionDetail(session) {
  return stripSessionShape(session, { includeQueuedMessages: true });
}
