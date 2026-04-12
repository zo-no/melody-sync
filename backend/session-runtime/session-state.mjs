import { normalizeLongTermSessionProjection } from '../session/long-term-projection.mjs';
import { normalizeText } from '../shared/text.mjs';

const SESSION_STATE_LINE_ROLES = new Set(['main', 'branch']);

function firstMeaningfulText(value) {
  const items = Array.isArray(value) ? value : [];
  for (const entry of items) {
    const normalized = normalizeText(entry);
    if (normalized) return normalized;
  }
  return '';
}

function normalizeNeedsUser(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'yes', 'waiting', 'needs_user', 'needs-user'].includes(normalized);
  }
  return false;
}

function normalizeLineRole(value) {
  const normalized = normalizeText(value).toLowerCase();
  return SESSION_STATE_LINE_ROLES.has(normalized) ? normalized : 'main';
}

function extractTaskCardNeedsUser(taskCard) {
  const raw = taskCard?.needsFromUser;
  if (Array.isArray(raw)) {
    return raw.some((entry) => normalizeText(entry));
  }
  return Boolean(normalizeText(raw));
}

export function normalizeSessionState(value = {}) {
  const longTerm = normalizeLongTermSessionProjection(value.longTerm);
  return {
    goal: normalizeText(value.goal),
    mainGoal: normalizeText(value.mainGoal),
    checkpoint: normalizeText(value.checkpoint),
    needsUser: normalizeNeedsUser(value.needsUser),
    lineRole: normalizeLineRole(value.lineRole),
    branchFrom: normalizeText(value.branchFrom),
    ...(longTerm ? { longTerm } : {}),
  };
}

export function resolveSessionStateFromSession(session = {}, context = null) {
  const taskCard = session?.taskCard && typeof session.taskCard === 'object' ? session.taskCard : {};
  const rawSessionState = session?.sessionState && typeof session.sessionState === 'object'
    ? session.sessionState
    : {};
  const seed = normalizeSessionState(rawSessionState);
  const seedLineRole = normalizeText(rawSessionState?.lineRole);
  const inferredLineRole = context?.parentSessionId
    ? 'branch'
    : normalizeLineRole(seedLineRole || taskCard?.lineRole);
  const goal = normalizeText(
    seed.goal
    || taskCard?.goal
    || session?.name
  );
  const mainGoal = normalizeText(
    seed.mainGoal
    || context?.mainGoal
    || taskCard?.mainGoal
    || (inferredLineRole === 'branch' ? taskCard?.branchFrom : '')
    || goal
    || session?.name
  );
  const checkpoint = normalizeText(
    seed.checkpoint
    || taskCard?.checkpoint
    || taskCard?.summary
    || firstMeaningfulText(taskCard?.knownConclusions)
    || firstMeaningfulText(taskCard?.nextSteps)
  );
  const branchFrom = inferredLineRole === 'branch'
    ? normalizeText(
      seed.branchFrom
      || taskCard?.branchFrom
      || context?.parentSessionName
    )
    : '';
  const needsUser = normalizeNeedsUser(
    seed.needsUser
    || extractTaskCardNeedsUser(taskCard)
    || session?.workflowState === 'waiting_user'
  );

  return normalizeSessionState({
    goal,
    mainGoal,
    checkpoint,
    needsUser,
    lineRole: inferredLineRole,
    branchFrom,
    longTerm: seed.longTerm,
  });
}
