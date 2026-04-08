import {
  appendRunSpoolRecord,
  getRun,
  updateRun,
  writeRunResult,
} from './store.mjs';

export async function finalizeSidecarRunError(runId, {
  nowIso,
  error,
  forcedFailureReason = '',
} = {}) {
  const errorMessage = forcedFailureReason || error?.message || 'Unknown sidecar error';
  await appendRunSpoolRecord(runId, {
    ts: nowIso(),
    stream: 'error',
    line: error?.message || errorMessage,
  });
  const result = {
    completedAt: nowIso(),
    exitCode: 1,
    signal: null,
    error: errorMessage,
  };
  await writeRunResult(runId, result);
  await updateRun(runId, (current) => ({
    ...current,
    state: current?.cancelRequested ? 'cancelled' : 'failed',
    completedAt: result.completedAt,
    result,
    failureReason: errorMessage,
  }));
}

export async function finalizeSidecarRunExit(runId, run, {
  nowIso,
  appendCodexContextMetrics,
  code,
  signal,
  forcedFailureReason = '',
} = {}) {
  const current = await getRun(runId) || run;
  const completedAt = nowIso();
  await appendCodexContextMetrics(runId);
  const finalFailureReason = forcedFailureReason || current?.failureReason || null;
  const result = {
    completedAt,
    exitCode: code ?? 1,
    signal: signal || null,
    cancelled: current.cancelRequested === true,
    ...(finalFailureReason ? { error: finalFailureReason } : {}),
  };
  await writeRunResult(runId, result);
  await updateRun(runId, (draft) => ({
    ...draft,
    state: draft.cancelRequested
      ? 'cancelled'
      : finalFailureReason
        ? 'failed'
        : (code ?? 1) === 0
          ? 'completed'
          : 'failed',
    completedAt,
    result,
    failureReason: draft.cancelRequested
      ? null
      : finalFailureReason || draft.failureReason || null,
  }));
  return code ?? 1;
}
