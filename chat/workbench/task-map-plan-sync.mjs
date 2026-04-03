import { persistTaskMapPlans, readTaskMapPlans } from './task-map-plans.mjs';
import { syncSessionTaskCardFromTaskMapPlans } from './node-task-card-sync.mjs';
import { trimText } from './shared.mjs';

function getSessionRootSessionId(session = null) {
  return trimText(session?.rootSessionId || session?.id);
}

function listAffectedRootSessionIds(previousTaskMapPlans = [], nextTaskMapPlans = []) {
  const rootSessionIds = new Set();
  for (const plan of [...(Array.isArray(previousTaskMapPlans) ? previousTaskMapPlans : []), ...(Array.isArray(nextTaskMapPlans) ? nextTaskMapPlans : [])]) {
    const rootSessionId = trimText(plan?.rootSessionId);
    if (rootSessionId) rootSessionIds.add(rootSessionId);
  }
  return [...rootSessionIds];
}

function collectManagedBindingKeysForRootSession(taskMapPlans = [], rootSessionId = '') {
  const normalizedRootSessionId = trimText(rootSessionId);
  if (!normalizedRootSessionId) return [];
  const seen = new Set();
  const keys = [];
  for (const plan of Array.isArray(taskMapPlans) ? taskMapPlans : []) {
    if (trimText(plan?.rootSessionId) !== normalizedRootSessionId) continue;
    for (const node of Array.isArray(plan?.nodes) ? plan.nodes : []) {
      for (const bindingKey of Array.isArray(node?.taskCardBindings) ? node.taskCardBindings : []) {
        const normalizedKey = trimText(bindingKey);
        if (!normalizedKey || seen.has(normalizedKey)) continue;
        seen.add(normalizedKey);
        keys.push(normalizedKey);
      }
    }
  }
  return keys;
}

export async function syncSessionTaskCardsForTaskMapPlans({
  previousTaskMapPlans = [],
  nextTaskMapPlans = [],
  sessions = [],
  updateSessionTaskCard = null,
} = {}) {
  if (typeof updateSessionTaskCard !== 'function') {
    return [];
  }
  const normalizedSessions = Array.isArray(sessions) ? sessions.filter((session) => session?.id) : [];
  if (!normalizedSessions.length) {
    return [];
  }

  const updates = [];
  const affectedRootSessionIds = listAffectedRootSessionIds(previousTaskMapPlans, nextTaskMapPlans);
  for (const rootSessionId of affectedRootSessionIds) {
    const managedBindingKeys = collectManagedBindingKeysForRootSession(
      [...(Array.isArray(previousTaskMapPlans) ? previousTaskMapPlans : []), ...(Array.isArray(nextTaskMapPlans) ? nextTaskMapPlans : [])],
      rootSessionId,
    );
    if (!managedBindingKeys.length) continue;

    const scopedTaskMapPlans = (Array.isArray(nextTaskMapPlans) ? nextTaskMapPlans : []).filter((plan) => (
      trimText(plan?.rootSessionId) === rootSessionId
    ));
    for (const session of normalizedSessions) {
      if (getSessionRootSessionId(session) !== rootSessionId) continue;
      const updatedSession = await syncSessionTaskCardFromTaskMapPlans({
        session,
        taskMapPlans: scopedTaskMapPlans,
        updateSessionTaskCard,
        managedBindingKeys,
      });
      updates.push({
        sessionId: session.id,
        rootSessionId,
        managedBindingKeys,
        taskCard: updatedSession?.taskCard || session?.taskCard || null,
      });
    }
  }

  return updates;
}

export async function persistTaskMapPlansWithSessionSync({
  plans = [],
  sessions = [],
  updateSessionTaskCard = null,
} = {}) {
  const previousTaskMapPlans = await readTaskMapPlans();
  const nextTaskMapPlans = await persistTaskMapPlans(plans);
  const taskCardUpdates = await syncSessionTaskCardsForTaskMapPlans({
    previousTaskMapPlans,
    nextTaskMapPlans,
    sessions,
    updateSessionTaskCard,
  });
  return {
    previousTaskMapPlans,
    nextTaskMapPlans,
    taskCardUpdates,
  };
}

export {
  collectManagedBindingKeysForRootSession,
  listAffectedRootSessionIds,
};
