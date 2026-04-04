import { NODE_TASK_CARD_BINDING_KEYS } from './node-definitions.mjs';
import { buildTaskCardPatchForSourceSession } from './node-task-card.mjs';
import { normalizeSessionTaskCard } from '../session-task-card.mjs';
import { trimText } from './shared.mjs';

const ARRAY_BINDING_KEYS = new Set(['candidateBranches', 'nextSteps']);

function normalizeBindingKeys(values = []) {
  const allowlistMap = new Map(NODE_TASK_CARD_BINDING_KEYS.map((value) => [trimText(value).toLowerCase(), value]));
  const normalized = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const key = allowlistMap.get(trimText(value).toLowerCase());
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

function getSessionRootSessionId(session = null) {
  return trimText(session?.rootSessionId || session?.id);
}

function listTaskMapPlanNodesForRootSession(taskMapPlans = [], rootSessionId = '') {
  const normalizedRootSessionId = trimText(rootSessionId);
  if (!normalizedRootSessionId) return [];
  return (Array.isArray(taskMapPlans) ? taskMapPlans : [])
    .filter((plan) => trimText(plan?.rootSessionId) === normalizedRootSessionId)
    .flatMap((plan) => (Array.isArray(plan?.nodes) ? plan.nodes : []));
}

function buildManagedTaskCardPatch({
  session = null,
  taskMapPlans = [],
  managedBindingKeys = [],
} = {}) {
  const sourceSessionId = trimText(session?.id);
  const rootSessionId = getSessionRootSessionId(session);
  if (!sourceSessionId || !rootSessionId) {
    return { patch: {}, managedKeys: [] };
  }
  const relevantNodes = listTaskMapPlanNodesForRootSession(taskMapPlans, rootSessionId);
  const patch = buildTaskCardPatchForSourceSession(relevantNodes, sourceSessionId);
  const managedKeys = normalizeBindingKeys(managedBindingKeys);
  return { patch, managedKeys };
}

function buildNextTaskCardFromNodePatch({
  taskCard = null,
  patch = {},
  managedBindingKeys = [],
} = {}) {
  const currentTaskCard = normalizeSessionTaskCard(taskCard || {}) || {};
  const nextTaskCard = { ...currentTaskCard };
  const normalizedPatch = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const managedKeys = normalizeBindingKeys([
    ...managedBindingKeys,
    ...Object.keys(normalizedPatch),
  ]);

  for (const key of managedKeys) {
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, key)) {
      nextTaskCard[key] = normalizedPatch[key];
      continue;
    }
    if (ARRAY_BINDING_KEYS.has(key)) {
      nextTaskCard[key] = [];
    }
  }

  const normalizedTaskCard = normalizeSessionTaskCard(nextTaskCard) || {};
  for (const key of managedKeys) {
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, key)) {
      normalizedTaskCard[key] = normalizedPatch[key];
      continue;
    }
    if (ARRAY_BINDING_KEYS.has(key)) {
      normalizedTaskCard[key] = [];
    }
  }
  return normalizedTaskCard;
}

export function buildSessionTaskCardFromTaskMapPlans({
  session = null,
  taskMapPlans = [],
  managedBindingKeys = [],
} = {}) {
  const { patch, managedKeys } = buildManagedTaskCardPatch({
    session,
    taskMapPlans,
    managedBindingKeys,
  });
  return buildNextTaskCardFromNodePatch({
    taskCard: session?.taskCard || null,
    patch,
    managedBindingKeys: managedKeys,
  });
}

export async function syncSessionTaskCardFromTaskMapPlans({
  session = null,
  taskMapPlans = [],
  updateSessionTaskCard = null,
  managedBindingKeys = [],
} = {}) {
  if (!session?.id || typeof updateSessionTaskCard !== 'function') {
    return session || null;
  }
  const normalizedManagedBindingKeys = normalizeBindingKeys(managedBindingKeys);
  const nextTaskCard = buildSessionTaskCardFromTaskMapPlans({
    session,
    taskMapPlans,
    managedBindingKeys: normalizedManagedBindingKeys,
  });
  const currentTaskCard = normalizeSessionTaskCard(
    session?.taskCard || null,
    normalizedManagedBindingKeys.includes('candidateBranches')
      ? { preserveCandidateBranches: true }
      : undefined,
  );
  if (JSON.stringify(currentTaskCard) === JSON.stringify(nextTaskCard)) {
    return session;
  }
  return updateSessionTaskCard(session.id, nextTaskCard, {
    managedBindingKeys: normalizedManagedBindingKeys,
  });
}

export {
  buildManagedTaskCardPatch,
  buildNextTaskCardFromNodePatch,
  listTaskMapPlanNodesForRootSession,
};
