import { getNodeKindDefinition } from './node-definitions.mjs';
import { persistTaskMapPlans, readTaskMapPlans } from './task-map-plans.mjs';

const BRANCH_CANDIDATE_HOOK_ID = 'builtin.branch-candidates';
const BRANCH_CANDIDATE_EVENT = 'branch.suggested';

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeText(value) {
  return trimText(value).replace(/\s+/g, ' ');
}

function clipText(value, max = 96) {
  const text = normalizeText(value);
  if (!text) return '';
  if (!Number.isInteger(max) || max <= 0 || text.length <= max) return text;
  if (max === 1) return '…';
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function slugify(value) {
  const slug = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'untitled';
}

function getTaskCard(session) {
  return session?.taskCard && typeof session.taskCard === 'object' ? session.taskCard : null;
}

function getTaskCardList(taskCard, key) {
  return Array.isArray(taskCard?.[key])
    ? taskCard[key].filter((entry) => typeof entry === 'string' && entry.trim())
    : [];
}

function getSuppressedBranchTitles(session) {
  return Array.isArray(session?.suppressedBranchTitles)
    ? session.suppressedBranchTitles.filter((entry) => typeof entry === 'string' && entry.trim())
    : [];
}

function getSessionRootSessionId(session) {
  return trimText(session?.rootSessionId || session?.id);
}

function getLineRole(session) {
  return trimText(session?.sourceContext?.parentSessionId) ? 'branch' : 'main';
}

function toConciseGoal(value, max = 56) {
  const compact = normalizeText(value);
  if (!compact) return '';
  const firstSegment = compact
    .split(/[。！？.!?\n]/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return clipText(firstSegment || compact, max);
}

function getSessionTitle(session) {
  const name = trimText(session?.name || '');
  const goal = trimText(session?.taskCard?.goal || '');
  const mainGoal = trimText(session?.taskCard?.mainGoal || '');
  const isBranch = getLineRole(session) === 'branch';
  return toConciseGoal(
    isBranch
      ? (goal || name || mainGoal || '当前任务')
      : (name || mainGoal || goal || '当前任务'),
    64,
  );
}

function getBranchTitle(session) {
  const raw = getSessionTitle(session);
  return raw.replace(/^(?:Branch\s*[·•-]\s*|支线\s*[·•:-]\s*)/i, '').trim() || raw;
}

function getCandidateKeysForSession(session) {
  return new Set([
    normalizeKey(getSessionTitle(session)),
    normalizeKey(getBranchTitle(session)),
    normalizeKey(session?.taskCard?.goal || ''),
    normalizeKey(session?.taskCard?.summary || ''),
    normalizeKey(session?.taskCard?.checkpoint || ''),
  ].filter(Boolean));
}

function createBranchCandidatePlanId(rootSessionId) {
  return `hook-plan:branch-candidates:${rootSessionId}`;
}

function isBranchCandidateHookPlan(plan, rootSessionId) {
  return trimText(plan?.rootSessionId) === trimText(rootSessionId)
    && trimText(plan?.source?.type).toLowerCase() === 'hook'
    && trimText(plan?.source?.hookId) === BRANCH_CANDIDATE_HOOK_ID;
}

function listQuestSessions(sessions = [], rootSessionId = '') {
  const normalizedRootSessionId = trimText(rootSessionId);
  return (Array.isArray(sessions) ? sessions : []).filter((session) => {
    if (!session?.id || session.archived) return false;
    return getSessionRootSessionId(session) === normalizedRootSessionId;
  });
}

function listDirectChildSessions(sessions = [], parentSessionId = '') {
  const normalizedParentSessionId = trimText(parentSessionId);
  if (!normalizedParentSessionId) return [];
  return (Array.isArray(sessions) ? sessions : []).filter((session) => {
    if (!session?.id || session.archived) return false;
    return trimText(session?.sourceContext?.parentSessionId) === normalizedParentSessionId;
  });
}

function buildBranchCandidatePlanNodes(sessions = []) {
  const candidateDefinition = getNodeKindDefinition('candidate');
  const composition = candidateDefinition?.composition || {};
  const defaultSummary = candidateDefinition?.description || '建议拆成独立支线';
  const nodes = [];

  for (const session of sessions) {
    const sourceSessionId = trimText(session?.id);
    if (!sourceSessionId) continue;
    const taskCard = getTaskCard(session);
    const rawCandidates = getTaskCardList(taskCard, 'candidateBranches');
    if (!rawCandidates.length) continue;

    const suppressedKeys = new Set(
      getSuppressedBranchTitles(session).map((title) => normalizeKey(title)),
    );
    const directChildSessions = listDirectChildSessions(sessions, sourceSessionId);
    const existingChildKeys = new Set();
    for (const childSession of directChildSessions) {
      for (const key of getCandidateKeysForSession(childSession)) {
        existingChildKeys.add(key);
      }
    }

    const seenCandidates = new Set();
    for (const candidateTitle of rawCandidates) {
      const normalizedTitle = toConciseGoal(candidateTitle, 64);
      const candidateKey = normalizeKey(normalizedTitle);
      if (!candidateKey) continue;
      if (seenCandidates.has(candidateKey)) continue;
      if (suppressedKeys.has(candidateKey)) continue;
      if (existingChildKeys.has(candidateKey)) continue;
      seenCandidates.add(candidateKey);
      nodes.push({
        id: `candidate:${sourceSessionId}:${slugify(normalizedTitle)}`,
        kind: 'candidate',
        title: normalizedTitle,
        summary: clipText(taskCard?.branchReason || defaultSummary, 120),
        sourceSessionId,
        parentNodeId: `session:${sourceSessionId}`,
        status: 'candidate',
        lineRole: 'candidate',
        capabilities: Array.isArray(composition.capabilities) ? [...composition.capabilities] : ['create-branch', 'dismiss'],
        surfaceBindings: Array.isArray(composition.surfaceBindings) ? [...composition.surfaceBindings] : ['task-map', 'composer-suggestions'],
        view: {
          type: trimText(composition.defaultViewType || 'flow-node') || 'flow-node',
        },
      });
    }
  }

  return nodes;
}

export function buildBranchCandidateTaskMapPlan({
  rootSessionId = '',
  sessions = [],
  generatedAt = '',
} = {}) {
  const normalizedRootSessionId = trimText(rootSessionId);
  if (!normalizedRootSessionId) return null;
  const questSessions = listQuestSessions(sessions, normalizedRootSessionId);
  if (!questSessions.length) return null;

  const nodes = buildBranchCandidatePlanNodes(questSessions);
  if (!nodes.length) return null;

  return {
    id: createBranchCandidatePlanId(normalizedRootSessionId),
    questId: `quest:${normalizedRootSessionId}`,
    rootSessionId: normalizedRootSessionId,
    mode: 'augment-default',
    title: '',
    summary: '',
    nodes,
    edges: [],
    source: {
      type: 'hook',
      hookId: BRANCH_CANDIDATE_HOOK_ID,
      event: BRANCH_CANDIDATE_EVENT,
      generatedAt: trimText(generatedAt),
    },
    updatedAt: trimText(generatedAt),
  };
}

export async function syncBranchCandidateTaskMapPlan({
  session = null,
  sessions = [],
  nowIso = () => new Date().toISOString(),
} = {}) {
  const rootSessionId = getSessionRootSessionId(session);
  if (!rootSessionId) return [];

  const existingPlans = await readTaskMapPlans();
  const nextPlans = existingPlans.filter((plan) => !isBranchCandidateHookPlan(plan, rootSessionId));
  const nextPlan = buildBranchCandidateTaskMapPlan({
    rootSessionId,
    sessions,
    generatedAt: typeof nowIso === 'function' ? nowIso() : '',
  });
  if (nextPlan) {
    nextPlans.push(nextPlan);
  }
  return persistTaskMapPlans(nextPlans);
}

export {
  BRANCH_CANDIDATE_EVENT,
  BRANCH_CANDIDATE_HOOK_ID,
};
