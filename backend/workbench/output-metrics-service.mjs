import { resolveSessionStateFromSession } from '../session-runtime/session-state.mjs';
import {
  normalizeSessionWorkflowState,
  SESSION_WORKFLOW_STATE_DONE,
  SESSION_WORKFLOW_STATE_PARKED,
  SESSION_WORKFLOW_STATE_WAITING_USER,
} from '../session/workflow-state.mjs';
import { getLongTermTaskPoolMembership } from '../session/task-pool-membership.mjs';
import { normalizePersistentKind } from '../session/persistent-kind.mjs';
import { getLatestSessionContext } from './continuity-store.mjs';
import { listWorkbenchSessions } from './session-ports.mjs';
import { loadWorkbenchState } from './state-store.mjs';
import {
  normalizeBranchContextStatus,
  normalizeNullableText,
  sortByUpdatedDesc,
} from './shared.mjs';

const RESOLVED_BRANCH_STATUSES = new Set(['resolved', 'merged']);
const RECENT_LIST_LIMIT = 5;
const OUTPUT_METRICS_SCOPE_SESSIONS = 'sessions';
const OUTPUT_METRICS_SCOPE_LONG_TERM = 'long-term';

function normalizeNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeBranchDispatchSignalForMetrics(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      attempts: 0,
      successes: 0,
      failures: 0,
      dayAttempts: 0,
      daySuccesses: 0,
      dayFailures: 0,
      dayStart: '',
      lastAttemptAt: '',
      lastSuccessAt: '',
      lastFailureAt: '',
      lastFailureReason: '',
      lastOutcome: '',
      lastOutcomeAt: '',
      lastBranchTitle: '',
      lastAttemptSource: '',
    };
  }
  return {
    attempts: normalizeNonNegativeInt(value.attempts),
    successes: normalizeNonNegativeInt(value.successes),
    failures: normalizeNonNegativeInt(value.failures),
    dayAttempts: normalizeNonNegativeInt(value.dayAttempts),
    daySuccesses: normalizeNonNegativeInt(value.daySuccesses),
    dayFailures: normalizeNonNegativeInt(value.dayFailures),
    dayStart: normalizeNullableText(value.dayStart),
    lastAttemptAt: normalizeNullableText(value.lastAttemptAt),
    lastSuccessAt: normalizeNullableText(value.lastSuccessAt),
    lastFailureAt: normalizeNullableText(value.lastFailureAt),
    lastFailureReason: normalizeNullableText(value.lastFailureReason),
    lastOutcome: normalizeNullableText(value.lastOutcome),
    lastOutcomeAt: normalizeNullableText(value.lastOutcomeAt),
    lastBranchTitle: normalizeNullableText(value.lastBranchTitle),
    lastAttemptSource: normalizeNullableText(value.lastAttemptSource),
  };
}

function toTimestamp(value) {
  return Date.parse(String(value || '').trim()) || 0;
}

function startOfLocalDay(dayOffset = 0, now = new Date()) {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + dayOffset,
    0,
    0,
    0,
    0,
  );
}

function isBetween(stampValue, startMs, endMs) {
  const stamp = toTimestamp(stampValue);
  return stamp >= startMs && stamp < endMs;
}

function normalizeList(values = []) {
  const items = Array.isArray(values) ? values : [];
  return items
    .map((entry) => normalizeNullableText(entry))
    .filter(Boolean);
}

function clipText(value, max = 120) {
  const text = normalizeNullableText(value).replace(/\s+/g, ' ');
  if (!text || !Number.isInteger(max) || max <= 0 || text.length <= max) {
    return text;
  }
  if (max === 1) return '…';
  return `${text.slice(0, max - 1).trimEnd()}…`;
}


export function normalizeOutputMetricsScope(value) {
  const normalized = normalizeNullableText(value).toLowerCase().replace(/[\s_]+/g, '-');
  if (['long-term', 'longterm', 'persistent', 'recurring'].includes(normalized)) {
    return OUTPUT_METRICS_SCOPE_LONG_TERM;
  }
  return OUTPUT_METRICS_SCOPE_SESSIONS;
}

function getSessionParentSessionId(session = null) {
  return normalizeNullableText(
    session?._branchParentSessionId
    || session?.branchParentSessionId
    || session?.sourceContext?.parentSessionId,
  );
}

function buildSessionScopeIndex(sessions = []) {
  const sessionById = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const sessionId = normalizeNullableText(session?.id);
    if (sessionId) sessionById.set(sessionId, session);
  }

  const scopeById = new Map();
  const resolving = new Set();

  function resolveSessionScope(session = null) {
    const sessionId = normalizeNullableText(session?.id);
    if (!sessionId) return OUTPUT_METRICS_SCOPE_SESSIONS;
    if (scopeById.has(sessionId)) return scopeById.get(sessionId);
    if (resolving.has(sessionId)) return OUTPUT_METRICS_SCOPE_SESSIONS;

    resolving.add(sessionId);
    let scope = OUTPUT_METRICS_SCOPE_SESSIONS;

    if (getLongTermTaskPoolMembership(session, {
      getSessionById: (candidateId) => sessionById.get(normalizeNullableText(candidateId)) || null,
    })) {
      scope = OUTPUT_METRICS_SCOPE_LONG_TERM;
    } else {
      const ancestorIds = [];
      const rootSessionId = normalizeNullableText(session?.rootSessionId);
      const parentSessionId = getSessionParentSessionId(session);
      if (rootSessionId && rootSessionId !== sessionId) {
        ancestorIds.push(rootSessionId);
      }
      if (
        parentSessionId
        && parentSessionId !== sessionId
        && !ancestorIds.includes(parentSessionId)
      ) {
        ancestorIds.push(parentSessionId);
      }
      for (const ancestorId of ancestorIds) {
        const ancestor = sessionById.get(ancestorId);
        if (!ancestor) continue;
        if (resolveSessionScope(ancestor) === OUTPUT_METRICS_SCOPE_LONG_TERM) {
          scope = OUTPUT_METRICS_SCOPE_LONG_TERM;
          break;
        }
      }
    }

    resolving.delete(sessionId);
    scopeById.set(sessionId, scope);
    return scope;
  }

  for (const session of sessionById.values()) {
    resolveSessionScope(session);
  }

  return scopeById;
}

export function resolveOutputMetricsScopeForSession(
  sessions = [],
  sessionId = '',
  fallbackScope = OUTPUT_METRICS_SCOPE_SESSIONS,
) {
  const normalizedSessionId = normalizeNullableText(sessionId);
  if (!normalizedSessionId) {
    return normalizeOutputMetricsScope(fallbackScope);
  }
  const scopeById = buildSessionScopeIndex(sessions);
  return scopeById.get(normalizedSessionId) || normalizeOutputMetricsScope(fallbackScope);
}

function buildSessionMetricRecord(session, state, sessionScopeIndex = null) {
  const latestContext = getLatestSessionContext(state, session?.id);
  const sessionState = resolveSessionStateFromSession(session, latestContext || null);
  const taskCard = session?.taskCard && typeof session.taskCard === 'object' ? session.taskCard : {};
  const workflowState = normalizeSessionWorkflowState(session?.workflowState || '');
  const checkpoint = normalizeNullableText(taskCard?.checkpoint || sessionState?.checkpoint);
  const knownConclusions = normalizeList(taskCard?.knownConclusions);
  const nextSteps = normalizeList(taskCard?.nextSteps);
  const summary = normalizeNullableText(taskCard?.summary);
  const touchedAt = normalizeNullableText(
    session?.updatedAt
    || session?.lastEventAt
    || session?.createdAt
    || session?.created,
  );
  const createdAt = normalizeNullableText(session?.createdAt || session?.created || touchedAt);
  const goal = normalizeNullableText(
    taskCard?.goal
    || sessionState?.goal
    || session?.name,
  );
  const mainGoal = normalizeNullableText(
    taskCard?.mainGoal
    || sessionState?.mainGoal
    || goal,
  );
  const structured = Boolean(checkpoint || knownConclusions.length > 0 || nextSteps.length > 0 || summary);
  const lineRole = sessionState?.lineRole === 'branch' ? 'branch' : 'main';
  const persistentKind = normalizePersistentKind(session?.persistent?.kind || '');
  const sessionId = normalizeNullableText(session?.id);

  return {
    id: sessionId,
    title: clipText(goal || mainGoal || session?.name || '未命名任务', 96),
    goal,
    mainGoal,
    summary,
    checkpoint,
    knownConclusionsCount: knownConclusions.length,
    nextStep: nextSteps[0] || '',
    lineRole,
    workflowState,
    archived: session?.archived === true,
    persistentKind,
    scope: sessionScopeIndex instanceof Map
      ? (sessionScopeIndex.get(sessionId) || OUTPUT_METRICS_SCOPE_SESSIONS)
      : OUTPUT_METRICS_SCOPE_SESSIONS,
    touchedAt,
    createdAt,
    structured,
    workflowSignals: session?.workflowSignals && typeof session.workflowSignals === 'object' && !Array.isArray(session.workflowSignals)
      ? session.workflowSignals
      : {},
    updatedAt: normalizeNullableText(session?.updatedAt),
    latestContext,
  };
}

function buildWorkflowSignalSummary(sessionMetrics = []) {
  const summary = {
    repeatedClarificationCount: 0,
    repeatedClarificationInWindow: 0,
    branchDispatch: {
      attempts: 0,
      successes: 0,
      failures: 0,
      dayAttempts: 0,
      daySuccesses: 0,
      dayFailures: 0,
      successRate: 0,
      daySuccessRate: 0,
    },
  };

  const windowStartMs = startOfLocalDay(0, new Date()).getTime();

  for (const entry of Array.isArray(sessionMetrics) ? sessionMetrics : []) {
    const signals = entry?.workflowSignals && typeof entry.workflowSignals === 'object'
      ? entry.workflowSignals
      : {};
    const totalRepeated = normalizeNonNegativeInt(signals.repeatedClarificationCount);
    const lastRepeatedAt = toTimestamp(signals.lastRepeatedClarificationAt);
    summary.repeatedClarificationCount += totalRepeated;
    if (lastRepeatedAt >= windowStartMs) {
      summary.repeatedClarificationInWindow += 1;
    }

    const branchDispatch = normalizeBranchDispatchSignalForMetrics(signals.branchDispatch);
    summary.branchDispatch.attempts += normalizeNonNegativeInt(branchDispatch.attempts);
    summary.branchDispatch.successes += normalizeNonNegativeInt(branchDispatch.successes);
    summary.branchDispatch.failures += normalizeNonNegativeInt(branchDispatch.failures);
    summary.branchDispatch.dayAttempts += normalizeNonNegativeInt(branchDispatch.dayAttempts);
    summary.branchDispatch.daySuccesses += normalizeNonNegativeInt(branchDispatch.daySuccesses);
    summary.branchDispatch.dayFailures += normalizeNonNegativeInt(branchDispatch.dayFailures);
  }

  const attempts = summary.branchDispatch.attempts;
  const dayAttempts = summary.branchDispatch.dayAttempts;
  summary.branchDispatch.successRate = attempts > 0
    ? Math.min(1, Math.round((summary.branchDispatch.successes / attempts) * 10000) / 10000)
    : 0;
  summary.branchDispatch.daySuccessRate = dayAttempts > 0
    ? Math.min(1, Math.round((summary.branchDispatch.daySuccesses / dayAttempts) * 10000) / 10000)
    : 0;

  return summary;
}

function roundRatio(value) {
  return Number.isFinite(value) && value > 0
    ? Math.round(value * 10000) / 10000
    : 0;
}

function computeConvergenceRate({
  openedSessions = 0,
  closedSessions = 0,
} = {}) {
  if (openedSessions <= 0) {
    return closedSessions > 0 ? 1 : 0;
  }
  return roundRatio(closedSessions / openedSessions);
}

function buildResolvedBranchClosedAtMap(branchContexts = []) {
  const closedAtBySessionId = new Map();
  for (const entry of Array.isArray(branchContexts) ? branchContexts : []) {
    if (!RESOLVED_BRANCH_STATUSES.has(entry?.status)) continue;
    const sessionId = normalizeNullableText(entry?.sessionId);
    const updatedAtMs = toTimestamp(entry?.updatedAt);
    if (!sessionId || updatedAtMs <= 0) continue;
    const existing = closedAtBySessionId.get(sessionId) || 0;
    if (existing <= 0 || updatedAtMs < existing) {
      closedAtBySessionId.set(sessionId, updatedAtMs);
    }
  }
  return closedAtBySessionId;
}

function getSessionClosedAt(entry, resolvedBranchClosedAtMap) {
  const resolvedAt = resolvedBranchClosedAtMap instanceof Map
    ? (resolvedBranchClosedAtMap.get(entry?.id) || 0)
    : 0;
  const doneAt = entry?.workflowState === SESSION_WORKFLOW_STATE_DONE
    ? toTimestamp(entry?.touchedAt)
    : 0;
  if (resolvedAt > 0 && doneAt > 0) {
    return Math.min(resolvedAt, doneAt);
  }
  return Math.max(resolvedAt, doneAt, 0);
}

function isSessionOpenAt(entry, resolvedBranchClosedAtMap, atMs) {
  const createdAtMs = toTimestamp(entry?.createdAt);
  if (createdAtMs <= 0 || createdAtMs >= atMs) {
    return false;
  }
  const closedAtMs = getSessionClosedAt(entry, resolvedBranchClosedAtMap);
  return closedAtMs <= 0 || closedAtMs >= atMs;
}

function countOpenSessionsAt(sessionMetrics, resolvedBranchClosedAtMap, atMs) {
  return (Array.isArray(sessionMetrics) ? sessionMetrics : [])
    .filter((entry) => isSessionOpenAt(entry, resolvedBranchClosedAtMap, atMs))
    .length;
}

function summarizeWindow(sessionMetrics, branchContexts, { startMs, endMs, resolvedBranchClosedAtMap = null }) {
  const effectiveResolvedBranchClosedAtMap = resolvedBranchClosedAtMap instanceof Map
    ? resolvedBranchClosedAtMap
    : buildResolvedBranchClosedAtMap(branchContexts);
  const allResolvedBranchSessionIds = new Set(
    effectiveResolvedBranchClosedAtMap.keys(),
  );
  const openedSessions = sessionMetrics.filter((entry) => isBetween(entry.createdAt, startMs, endMs));
  const completedSessionIds = new Set(
    sessionMetrics
      .filter((entry) => entry.workflowState === SESSION_WORKFLOW_STATE_DONE)
      .filter((entry) => !allResolvedBranchSessionIds.has(entry.id))
      .filter((entry) => isBetween(entry.touchedAt, startMs, endMs))
      .map((entry) => entry.id)
      .filter(Boolean),
  );
  const resolvedBranchIds = new Set(
    branchContexts
      .filter((entry) => RESOLVED_BRANCH_STATUSES.has(entry.status))
      .filter((entry) => isBetween(entry.updatedAt, startMs, endMs))
      .map((entry) => entry.sessionId)
      .filter(Boolean),
  );
  const closedSessions = completedSessionIds.size + resolvedBranchIds.size;
  const netOpenDelta = openedSessions.length - closedSessions;
  const endOpenSessions = countOpenSessionsAt(sessionMetrics, effectiveResolvedBranchClosedAtMap, endMs);

  return {
    openedSessions: openedSessions.length,
    completedSessions: completedSessionIds.size,
    resolvedBranches: resolvedBranchIds.size,
    closedSessions,
    netOpenDelta,
    endOpenSessions,
    convergenceRate: computeConvergenceRate({
      openedSessions: openedSessions.length,
      closedSessions,
    }),
  };
}

function describeLoad({
  openSessions = 0,
  activeMainSessions = 0,
  activeBranchSessions = 0,
  waitingSessions = 0,
  parkedSessions = 0,
  structuredOpenSessions = 0,
} = {}) {
  if (openSessions <= 0) {
    return {
      label: '已清空',
      hint: '当前没有在开任务，可以直接开启下一条。',
    };
  }
  if (waitingSessions > 0) {
    return {
      label: '待处理',
      hint: `当前在开 ${openSessions} 条任务，其中 ${waitingSessions} 条等待你输入。`,
    };
  }
  if (activeMainSessions > 2) {
    return {
      label: '主线偏多',
      hint: `当前 ${activeMainSessions} 条主线同时进行，先收敛到 1-2 条更稳。`,
    };
  }
  if (activeBranchSessions > 3) {
    return {
      label: '支线偏多',
      hint: `当前 ${activeBranchSessions} 条支线还没收束，建议尽快合并或结束一部分。`,
    };
  }
  if (parkedSessions > 0 && activeMainSessions === 0 && activeBranchSessions === 0) {
    return {
      label: '多为停放',
      hint: `当前在开 ${openSessions} 条任务，但大多处于停放状态，可按优先级逐步重启。`,
    };
  }
  if (structuredOpenSessions < Math.ceil(openSessions / 2)) {
    return {
      label: '待结构化',
      hint: `当前在开 ${openSessions} 条任务，不少还缺 checkpoint 或结论，补结构更容易收口。`,
    };
  }
  return {
    label: '可控',
    hint: `当前在开 ${openSessions} 条任务，其中 ${activeMainSessions} 条主线、${activeBranchSessions} 条支线。`,
  };
}

function buildRecentWins(sessionMetrics, normalizedBranchContexts) {
  const resolvedBranchSessionIds = new Set(
    normalizedBranchContexts
      .filter((entry) => RESOLVED_BRANCH_STATUSES.has(entry.status))
      .map((entry) => entry.sessionId)
      .filter(Boolean),
  );
  const completedEntries = sessionMetrics
    .filter((entry) => entry.workflowState === SESSION_WORKFLOW_STATE_DONE)
    .filter((entry) => !(entry.lineRole === 'branch' && resolvedBranchSessionIds.has(entry.id)))
    .map((entry) => ({
      type: 'session_done',
      title: entry.title,
      detail: entry.lineRole === 'branch' ? '完成一条支线任务' : '完成一条主线任务',
      updatedAt: entry.touchedAt,
      at: entry.touchedAt,
    }));

  const sessionTitleMap = new Map(sessionMetrics.map((entry) => [entry.id, entry.title]));
  const resolvedBranchEntries = normalizedBranchContexts
    .filter((entry) => RESOLVED_BRANCH_STATUSES.has(entry.status))
    .map((entry) => ({
      type: 'branch_resolved',
      title: sessionTitleMap.get(entry.sessionId) || clipText(entry.goal || entry.mainGoal || '已收束支线', 96),
      detail: entry.mainGoal
        ? `支线已收束，回到：${clipText(entry.mainGoal, 48)}`
        : '支线已收束',
      updatedAt: entry.updatedAt,
      at: entry.updatedAt,
    }));

  return sortByUpdatedDesc([...completedEntries, ...resolvedBranchEntries]).slice(0, RECENT_LIST_LIMIT);
}

function buildAttentionList(sessionMetrics, { nowMs }) {
  const waitingEntries = sortByUpdatedDesc(
    sessionMetrics
      .filter((entry) => entry.workflowState === SESSION_WORKFLOW_STATE_WAITING_USER)
      .map((entry) => ({
        type: 'waiting_user',
        title: entry.title,
        detail: entry.checkpoint
          ? `等待你处理：${clipText(entry.checkpoint, 72)}`
          : '等待你继续输入或决策',
        updatedAt: entry.touchedAt,
      })),
  );

  const staleThresholdMs = nowMs - (3 * 24 * 60 * 60 * 1000);
  const staleEntries = sortByUpdatedDesc(
    sessionMetrics
      .filter((entry) => entry.workflowState === '')
      .filter((entry) => toTimestamp(entry.touchedAt) > 0 && toTimestamp(entry.touchedAt) < staleThresholdMs)
      .map((entry) => ({
        type: 'stale_active',
        title: entry.title,
        detail: '这条任务已经几天没有推进，适合尽快收口或停放。',
        updatedAt: entry.touchedAt,
      })),
  );

  return [...waitingEntries, ...staleEntries].slice(0, RECENT_LIST_LIMIT);
}

function createTrendLabel(date) {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${month}-${day}`;
}

export function buildWorkbenchOutputMetrics(state, sessions, options = {}) {
  const now = options?.now instanceof Date ? options.now : new Date();
  const scope = normalizeOutputMetricsScope(options?.scope);
  const nowMs = now.getTime();
  const dayStartMs = startOfLocalDay(0, now).getTime();
  const tomorrowStartMs = startOfLocalDay(1, now).getTime();
  const weekStartMs = startOfLocalDay(-6, now).getTime();
  const sessionScopeIndex = buildSessionScopeIndex(sessions);

  const sessionMetrics = (Array.isArray(sessions) ? sessions : [])
    .filter((session) => session?.id)
    .map((session) => buildSessionMetricRecord(session, state, sessionScopeIndex))
    .filter((entry) => entry.archived !== true);
  const taskSessionMetrics = sessionMetrics.filter((entry) => (
    !entry.persistentKind
    && entry.scope === scope
  ));

  const normalizedBranchContexts = (Array.isArray(state?.branchContexts) ? state.branchContexts : [])
    .map((entry) => ({
      sessionId: normalizeNullableText(entry?.sessionId),
      status: normalizeBranchContextStatus(entry?.status),
      updatedAt: normalizeNullableText(entry?.updatedAt || entry?.createdAt),
      goal: normalizeNullableText(entry?.goal),
      mainGoal: normalizeNullableText(entry?.mainGoal),
    }))
    .filter((entry) => entry.sessionId);
  const resolvedBranchClosedAtMap = buildResolvedBranchClosedAtMap(normalizedBranchContexts);

  const openSessions = taskSessionMetrics.filter((entry) => isSessionOpenAt(entry, resolvedBranchClosedAtMap, nowMs));
  const activeMainSessions = openSessions.filter((entry) => entry.lineRole === 'main' && entry.workflowState === '').length;
  const activeBranchSessions = openSessions.filter((entry) => entry.lineRole === 'branch' && entry.workflowState === '').length;
  const waitingSessions = openSessions.filter((entry) => entry.workflowState === SESSION_WORKFLOW_STATE_WAITING_USER).length;
  const parkedSessions = openSessions.filter((entry) => entry.workflowState === SESSION_WORKFLOW_STATE_PARKED).length;
  const structuredOpenSessions = openSessions.filter((entry) => entry.structured).length;
  const workflowSignals = buildWorkflowSignalSummary(taskSessionMetrics);
  const load = describeLoad({
    openSessions: openSessions.length,
    activeMainSessions,
    activeBranchSessions,
    waitingSessions,
    parkedSessions,
    structuredOpenSessions,
  });

  const today = summarizeWindow(taskSessionMetrics, normalizedBranchContexts, {
    startMs: dayStartMs,
    endMs: tomorrowStartMs,
    resolvedBranchClosedAtMap,
  });
  const week = summarizeWindow(taskSessionMetrics, normalizedBranchContexts, {
    startMs: weekStartMs,
    endMs: tomorrowStartMs,
    resolvedBranchClosedAtMap,
  });

  const trend = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const start = startOfLocalDay(-offset, now);
    const end = startOfLocalDay(-offset + 1, now);
    const summary = summarizeWindow(taskSessionMetrics, normalizedBranchContexts, {
      startMs: start.getTime(),
      endMs: end.getTime(),
      resolvedBranchClosedAtMap,
    });
    trend.push({
      date: start.toISOString().slice(0, 10),
      label: createTrendLabel(start),
      ...summary,
    });
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    scope,
    overview: {
      openSessions: openSessions.length,
      activeMainSessions,
      activeBranchSessions,
      waitingSessions,
      parkedSessions,
      loadLabel: load.label,
      loadHint: load.hint,
    },
    today,
    week,
    workflowSignals,
    trend,
    recentWins: buildRecentWins(taskSessionMetrics, normalizedBranchContexts),
    attention: buildAttentionList(taskSessionMetrics, { nowMs }),
  };
}

export async function getWorkbenchOutputMetrics() {
  const [state, sessions] = await Promise.all([
    loadWorkbenchState(),
    listWorkbenchSessions({ includeArchived: true }),
  ]);
  return buildWorkbenchOutputMetrics(state, sessions);
}
