import {
  getWorkbenchSession,
  listWorkbenchSessions,
  updateWorkbenchSessionTaskCard,
} from '../workbench-session-ports.mjs';
import { trimText } from './shared.mjs';
import { normalizeTaskMapPlan, readTaskMapPlans } from './task-map-plans.mjs';
import { persistTaskMapPlansWithSessionSync } from './task-map-plan-sync.mjs';

function nowIso() {
  return new Date().toISOString();
}

function getSessionRootSessionId(session = null) {
  return trimText(session?.rootSessionId || session?.id);
}

function isWritablePlanSourceType(value) {
  const sourceType = trimText(value).toLowerCase();
  return sourceType === 'manual' || sourceType === 'system';
}

function listTaskMapPlansForRootSession(taskMapPlans = [], rootSessionId = '') {
  const normalizedRootSessionId = trimText(rootSessionId);
  if (!normalizedRootSessionId) return [];
  return (Array.isArray(taskMapPlans) ? taskMapPlans : []).filter((plan) => (
    trimText(plan?.rootSessionId) === normalizedRootSessionId
  ));
}

async function resolveTaskMapPlanSessionScope(sessionId = '') {
  const normalizedSessionId = trimText(sessionId);
  if (!normalizedSessionId) {
    throw new Error('sessionId is required');
  }
  const session = await getWorkbenchSession(normalizedSessionId);
  if (!session?.id) {
    throw new Error('Session not found');
  }
  const rootSessionId = getSessionRootSessionId(session);
  if (!rootSessionId) {
    throw new Error('Session root not found');
  }
  const sessions = await listWorkbenchSessions({ includeArchived: true });
  return {
    session,
    rootSessionId,
    sessions: Array.isArray(sessions) ? sessions : [],
  };
}

function normalizeWritableTaskMapPlanInput({
  plan = {},
  rootSessionId = '',
  defaultQuestId = '',
  now = '',
} = {}) {
  const normalizedRootSessionId = trimText(rootSessionId);
  if (!normalizedRootSessionId) {
    throw new Error('rootSessionId is required');
  }

  const planId = trimText(plan?.id);
  if (!planId) {
    throw new Error('taskMapPlan.id is required');
  }

  const requestedRootSessionId = trimText(plan?.rootSessionId);
  if (requestedRootSessionId && requestedRootSessionId !== normalizedRootSessionId) {
    throw new Error('taskMapPlan.rootSessionId must match the requested session root');
  }

  const sourceType = trimText(plan?.source?.type || 'manual').toLowerCase() || 'manual';
  if (!isWritablePlanSourceType(sourceType)) {
    throw new Error('Only manual or system task-map plans can be written through this API');
  }

  const generatedAt = trimText(plan?.source?.generatedAt || plan?.source?.updatedAt || '') || now;
  const normalizedPlan = normalizeTaskMapPlan({
    ...plan,
    id: planId,
    rootSessionId: normalizedRootSessionId,
    questId: trimText(plan?.questId) || defaultQuestId || `quest:${normalizedRootSessionId}`,
    source: {
      ...(plan?.source && typeof plan.source === 'object' ? plan.source : {}),
      type: sourceType,
      generatedAt,
    },
    updatedAt: trimText(plan?.updatedAt) || now,
  });
  if (!normalizedPlan) {
    throw new Error('Invalid task-map plan payload');
  }
  if (!isWritablePlanSourceType(normalizedPlan?.source?.type)) {
    throw new Error('Only manual or system task-map plans can be written through this API');
  }
  return normalizedPlan;
}

function assertNoCrossRootPlanCollision(taskMapPlans = [], nextPlan = null, rootSessionId = '') {
  const normalizedPlanId = trimText(nextPlan?.id);
  if (!normalizedPlanId) return;
  const normalizedRootSessionId = trimText(rootSessionId);
  const existingPlan = (Array.isArray(taskMapPlans) ? taskMapPlans : []).find((plan) => (
    trimText(plan?.id) === normalizedPlanId
  ));
  if (!existingPlan) return;
  if (trimText(existingPlan?.rootSessionId) !== normalizedRootSessionId) {
    throw new Error(`taskMapPlan.id "${normalizedPlanId}" is already used by another root session`);
  }
}

export async function listTaskMapPlansForSession(sessionId = '') {
  const scope = await resolveTaskMapPlanSessionScope(sessionId);
  const taskMapPlans = listTaskMapPlansForRootSession(await readTaskMapPlans(), scope.rootSessionId);
  return {
    session: scope.session,
    rootSessionId: scope.rootSessionId,
    taskMapPlans,
  };
}

export async function saveTaskMapPlanForSession(sessionId = '', plan = {}, options = {}) {
  const scope = await resolveTaskMapPlanSessionScope(sessionId);
  const previousTaskMapPlans = await readTaskMapPlans();
  const nextPlan = normalizeWritableTaskMapPlanInput({
    plan,
    rootSessionId: scope.rootSessionId,
    defaultQuestId: `quest:${scope.rootSessionId}`,
    now: typeof options.nowIso === 'function' ? options.nowIso() : nowIso(),
  });
  assertNoCrossRootPlanCollision(previousTaskMapPlans, nextPlan, scope.rootSessionId);

  const nextPlans = previousTaskMapPlans.filter((entry) => trimText(entry?.id) !== nextPlan.id);
  nextPlans.push(nextPlan);

  const result = await persistTaskMapPlansWithSessionSync({
    plans: nextPlans,
    sessions: scope.sessions,
    updateSessionTaskCard: updateWorkbenchSessionTaskCard,
  });
  const taskMapPlans = listTaskMapPlansForRootSession(result.nextTaskMapPlans, scope.rootSessionId);
  return {
    session: scope.session,
    rootSessionId: scope.rootSessionId,
    taskMapPlan: taskMapPlans.find((entry) => trimText(entry?.id) === nextPlan.id) || null,
    taskMapPlans,
    taskCardUpdates: result.taskCardUpdates,
  };
}

export async function deleteTaskMapPlanForSession(sessionId = '', planId = '') {
  const scope = await resolveTaskMapPlanSessionScope(sessionId);
  const normalizedPlanId = trimText(planId);
  if (!normalizedPlanId) {
    throw new Error('planId is required');
  }

  const previousTaskMapPlans = await readTaskMapPlans();
  const targetPlan = previousTaskMapPlans.find((plan) => trimText(plan?.id) === normalizedPlanId);
  if (!targetPlan || trimText(targetPlan?.rootSessionId) !== scope.rootSessionId) {
    throw new Error('Task-map plan not found for the requested session');
  }

  const nextPlans = previousTaskMapPlans.filter((plan) => trimText(plan?.id) !== normalizedPlanId);
  const result = await persistTaskMapPlansWithSessionSync({
    plans: nextPlans,
    sessions: scope.sessions,
    updateSessionTaskCard: updateWorkbenchSessionTaskCard,
  });
  return {
    session: scope.session,
    rootSessionId: scope.rootSessionId,
    deletedPlanId: normalizedPlanId,
    taskMapPlans: listTaskMapPlansForRootSession(result.nextTaskMapPlans, scope.rootSessionId),
    taskCardUpdates: result.taskCardUpdates,
  };
}

export {
  listTaskMapPlansForRootSession,
  normalizeWritableTaskMapPlanInput,
  resolveTaskMapPlanSessionScope,
};
