import { mutateSessionMeta } from '../session/meta-store.mjs';
import { normalizeNullableText, nowIso } from './shared.mjs';

function normalizeNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function normalizeBranchDispatchSignal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      attempts: 0,
      successes: 0,
      failures: 0,
      dayStart: '',
      dayAttempts: 0,
      daySuccesses: 0,
      dayFailures: 0,
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
    dayStart: normalizeNullableText(value.dayStart),
    dayAttempts: normalizeNonNegativeInt(value.dayAttempts),
    daySuccesses: normalizeNonNegativeInt(value.daySuccesses),
    dayFailures: normalizeNonNegativeInt(value.dayFailures),
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

export async function recordBranchDispatchSignal(sessionId, {
  outcome = 'attempt',
  branchTitle = '',
  failureReason = '',
  sourceSessionId = '',
} = {}) {
  const normalizedSessionId = normalizeNullableText(sessionId);
  if (!normalizedSessionId) return null;
  const now = nowIso();
  const dayStart = now.slice(0, 10);

  const outcomeType = String(outcome || '').trim().toLowerCase();
  if (!['attempt', 'success', 'failure'].includes(outcomeType)) return null;
  const dispatchSource = normalizeNullableText(sourceSessionId) || normalizedSessionId;

  const result = await mutateSessionMeta(normalizedSessionId, (session) => {
    const signals = session?.workflowSignals && typeof session.workflowSignals === 'object'
      && !Array.isArray(session.workflowSignals)
      ? session.workflowSignals
      : {};
    const current = normalizeBranchDispatchSignal(signals.branchDispatch);
    const resetDaily = current.dayStart !== dayStart;
    const next = {
      ...current,
      dayStart,
      attempts: current.attempts + (outcomeType === 'attempt' ? 1 : 0),
      dayAttempts: (resetDaily ? 0 : current.dayAttempts) + (outcomeType === 'attempt' ? 1 : 0),
      daySuccesses: resetDaily ? 0 : current.daySuccesses,
      dayFailures: resetDaily ? 0 : current.dayFailures,
      lastAttemptAt: normalizeNullableText(current.lastAttemptAt),
      lastAttemptSource: normalizeNullableText(current.lastAttemptSource),
      lastFailureReason: normalizeNullableText(current.lastFailureReason),
      lastSuccessAt: normalizeNullableText(current.lastSuccessAt),
      lastFailureAt: normalizeNullableText(current.lastFailureAt),
      lastOutcome: outcomeType,
      lastOutcomeAt: now,
      lastBranchTitle: normalizeNullableText(branchTitle) || current.lastBranchTitle,
    };
    if (outcomeType === 'attempt') {
      next.lastAttemptAt = now;
      next.lastAttemptSource = dispatchSource;
    }
    if (outcomeType === 'success') {
      next.successes = current.successes + 1;
      next.daySuccesses = (resetDaily ? 0 : current.daySuccesses) + 1;
      next.lastSuccessAt = now;
      next.lastFailureReason = '';
      next.lastFailureAt = normalizeNullableText(current.lastFailureAt);
    }
    if (outcomeType === 'failure') {
      next.failures = current.failures + 1;
      next.dayFailures = (resetDaily ? 0 : current.dayFailures) + 1;
      next.lastFailureAt = now;
      next.lastFailureReason = normalizeNullableText(failureReason);
    }
    if (outcomeType === 'failure' && !next.lastFailureReason) {
      next.lastFailureReason = '分支派发失败';
    }
    session.workflowSignals = {
      ...(signals || {}),
      branchDispatch: next,
    };
    return true;
  });

  return result?.changed === true;
}
