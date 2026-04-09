import { resolveSessionStateFromSession } from '../session-runtime/session-state.mjs';
import {
  normalizeSessionWorkflowState,
  SESSION_WORKFLOW_STATE_DONE,
  SESSION_WORKFLOW_STATE_PARKED,
  SESSION_WORKFLOW_STATE_WAITING_USER,
} from '../session/workflow-state.mjs';
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

function buildSessionMetricRecord(session, state) {
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

  return {
    id: normalizeNullableText(session?.id),
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

function computeWindowScore({
  completedSessions = 0,
  resolvedBranches = 0,
  structuredSessions = 0,
  touchedSessions = 0,
} = {}) {
  const raw = (
    completedSessions * 18
    + resolvedBranches * 10
    + structuredSessions * 4
    + Math.min(10, touchedSessions * 2)
  );
  return Math.max(0, Math.min(100, raw));
}

function summarizeWindow(sessionMetrics, branchContexts, { startMs, endMs }) {
  const touchedSessions = sessionMetrics.filter((entry) => isBetween(entry.touchedAt, startMs, endMs));
  const completedSessions = touchedSessions.filter((entry) => entry.workflowState === SESSION_WORKFLOW_STATE_DONE);
  const structuredSessions = touchedSessions.filter((entry) => entry.structured);
  const resolvedBranchIds = new Set(
    branchContexts
      .filter((entry) => RESOLVED_BRANCH_STATUSES.has(entry.status))
      .filter((entry) => isBetween(entry.updatedAt, startMs, endMs))
      .map((entry) => entry.sessionId)
      .filter(Boolean),
  );

  return {
    score: computeWindowScore({
      completedSessions: completedSessions.length,
      resolvedBranches: resolvedBranchIds.size,
      structuredSessions: structuredSessions.length,
      touchedSessions: touchedSessions.length,
    }),
    touchedSessions: touchedSessions.length,
    completedSessions: completedSessions.length,
    resolvedBranches: resolvedBranchIds.size,
    structuredSessions: structuredSessions.length,
  };
}

function computeFocusScore({
  activeMainSessions = 0,
  activeBranchSessions = 0,
  waitingSessions = 0,
  structuredOpenSessions = 0,
} = {}) {
  const overloadedMainPenalty = Math.max(0, activeMainSessions - 2) * 18;
  const overloadedBranchPenalty = Math.max(0, activeBranchSessions - 3) * 10;
  const waitingPenalty = waitingSessions * 8;
  const structureBonus = Math.min(structuredOpenSessions * 4, 12);
  const score = 100 - overloadedMainPenalty - overloadedBranchPenalty - waitingPenalty + structureBonus;
  return Math.max(0, Math.min(100, score));
}

function describeFocus({
  activeMainSessions = 0,
  activeBranchSessions = 0,
  waitingSessions = 0,
  structuredOpenSessions = 0,
  openSessions = 0,
  focusScore = 0,
} = {}) {
  if (activeMainSessions > 2) {
    return {
      label: focusScore >= 60 ? '可控' : '过载',
      hint: '主线任务偏多，先收敛到 1-2 条主线更容易提升产出。',
    };
  }
  if (waitingSessions > 0) {
    return {
      label: focusScore >= 60 ? '可控' : '过载',
      hint: '有任务在等你输入，先清掉等待项能直接释放推进速度。',
    };
  }
  if (activeBranchSessions > 3) {
    return {
      label: focusScore >= 60 ? '可控' : '过载',
      hint: '支线数量偏多，建议合并或结束一部分支线。',
    };
  }
  if (openSessions > 0 && structuredOpenSessions < Math.ceil(openSessions / 2)) {
    return {
      label: focusScore >= 80 ? '聚焦' : '可控',
      hint: '不少任务还缺 checkpoint，先补任务结构会更稳。',
    };
  }
  return {
    label: focusScore >= 80 ? '聚焦' : '可控',
    hint: '当前主线数量可控，可以继续把完成数拉起来。',
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
  const nowMs = now.getTime();
  const dayStartMs = startOfLocalDay(0, now).getTime();
  const tomorrowStartMs = startOfLocalDay(1, now).getTime();
  const weekStartMs = startOfLocalDay(-6, now).getTime();

  const sessionMetrics = (Array.isArray(sessions) ? sessions : [])
    .filter((session) => session?.id)
    .map((session) => buildSessionMetricRecord(session, state))
    .filter((entry) => entry.archived !== true);

  const normalizedBranchContexts = (Array.isArray(state?.branchContexts) ? state.branchContexts : [])
    .map((entry) => ({
      sessionId: normalizeNullableText(entry?.sessionId),
      status: normalizeBranchContextStatus(entry?.status),
      updatedAt: normalizeNullableText(entry?.updatedAt || entry?.createdAt),
      goal: normalizeNullableText(entry?.goal),
      mainGoal: normalizeNullableText(entry?.mainGoal),
    }))
    .filter((entry) => entry.sessionId);

  const openSessions = sessionMetrics.filter((entry) => entry.workflowState !== SESSION_WORKFLOW_STATE_DONE);
  const activeMainSessions = openSessions.filter((entry) => entry.lineRole === 'main' && entry.workflowState === '').length;
  const activeBranchSessions = openSessions.filter((entry) => entry.lineRole === 'branch' && entry.workflowState === '').length;
  const waitingSessions = openSessions.filter((entry) => entry.workflowState === SESSION_WORKFLOW_STATE_WAITING_USER).length;
  const parkedSessions = openSessions.filter((entry) => entry.workflowState === SESSION_WORKFLOW_STATE_PARKED).length;
  const structuredOpenSessions = openSessions.filter((entry) => entry.structured).length;
  const workflowSignals = buildWorkflowSignalSummary(sessionMetrics);
  const focusScore = computeFocusScore({
    activeMainSessions,
    activeBranchSessions,
    waitingSessions,
    structuredOpenSessions,
  });
  const focus = describeFocus({
    activeMainSessions,
    activeBranchSessions,
    waitingSessions,
    structuredOpenSessions,
    openSessions: openSessions.length,
    focusScore,
  });

  const today = summarizeWindow(sessionMetrics, normalizedBranchContexts, {
    startMs: dayStartMs,
    endMs: tomorrowStartMs,
  });
  const week = summarizeWindow(sessionMetrics, normalizedBranchContexts, {
    startMs: weekStartMs,
    endMs: tomorrowStartMs,
  });

  const trend = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const start = startOfLocalDay(-offset, now);
    const end = startOfLocalDay(-offset + 1, now);
    const summary = summarizeWindow(sessionMetrics, normalizedBranchContexts, {
      startMs: start.getTime(),
      endMs: end.getTime(),
    });
    trend.push({
      date: start.toISOString().slice(0, 10),
      label: createTrendLabel(start),
      ...summary,
    });
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    overview: {
      activeMainSessions,
      activeBranchSessions,
      waitingSessions,
      parkedSessions,
      structuredOpenSessions,
      focusScore,
      focusLabel: focus.label,
      focusHint: focus.hint,
    },
    today,
    week,
    workflowSignals,
    trend,
    recentWins: buildRecentWins(sessionMetrics, normalizedBranchContexts),
    attention: buildAttentionList(sessionMetrics, { nowMs }),
  };
}

export async function getWorkbenchOutputMetrics() {
  const [state, sessions] = await Promise.all([
    loadWorkbenchState(),
    listWorkbenchSessions({ includeArchived: true }),
  ]);
  return buildWorkbenchOutputMetrics(state, sessions);
}
