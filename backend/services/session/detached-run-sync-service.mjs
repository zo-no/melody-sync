import { createToolInvocation } from '../../process-runner.mjs';
import {
  buildNormalizedRunResultEnvelope,
  mergeRunResultWithEnvelope,
  runResultEnvelopeHasMeaningfulContent,
} from '../../run/result-envelope.mjs';

function parseRecordTimestamp(record) {
  const parsed = Date.parse(record?.ts || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function isUserMessageEvent(event) {
  return event?.type === 'message' && event.role === 'user';
}

function normalizeRunEvents(run, events) {
  return (events || []).map((event) => ({
    ...event,
    runId: run.id,
    ...(run.requestId ? { requestId: run.requestId } : {}),
  }));
}

export function dropActiveRunGeneratedHistoryEvents(history = [], activeRunId = '') {
  if (!activeRunId) return Array.isArray(history) ? history : [];
  return (Array.isArray(history) ? history : []).filter((event) => {
    if (event?.runId !== activeRunId) return true;
    return isUserMessageEvent(event);
  });
}

export function withSyntheticSeqs(events = [], baseSeq = 0) {
  let nextSeq = Number.isInteger(baseSeq) && baseSeq > 0 ? baseSeq : 0;
  return (Array.isArray(events) ? events : []).map((event) => {
    nextSeq += 1;
    return {
      ...event,
      seq: nextSeq,
    };
  });
}

export function createDetachedRunSyncService({
  broadcastSessionInvalidation,
  clipFailurePreview,
  deriveRunFailureReasonFromResult,
  deriveRunStateFromResult,
  deriveStructuredRuntimeFailureReason,
  finalizeDetachedRun,
  findSessionMeta,
  flushQueuedFollowUps,
  getFollowUpQueueCount,
  getRun,
  getRunManifest,
  getRunResult,
  hasTerminalRunResult,
  isTerminalRunState,
  materializeRunSpoolLine,
  mutateSessionMeta,
  nowIso,
  parseTaskCardFromAssistantContent,
  persistResumeIds,
  readRunSpoolRecords,
  startupSyncDebug = false,
  stopObservedRun,
  structuredOutputSettleDelayMs = 1000,
  synthesizeDetachedRunTermination,
  updateRun,
  writeRunResult,
}) {
  const runSyncPromises = new Map();

  async function collectNormalizedRunEvents(run, manifest) {
    const runtimeInvocation = await createToolInvocation(manifest.tool, '', {
      model: manifest.options?.model,
      effort: manifest.options?.effort,
      thinking: manifest.options?.thinking,
    });
    const { adapter } = runtimeInvocation;
    const spoolRecords = await readRunSpoolRecords(run.id);
    if (startupSyncDebug) {
      console.log(`[startup-sync] spool loaded runId=${run.id} records=${spoolRecords.length}`);
    }
    const normalizedEvents = [];
    let stdoutLineCount = 0;
    let lastRecordTimestamp = null;

    for (const record of spoolRecords) {
      if (record?.stream !== 'stdout') continue;
      const line = await materializeRunSpoolLine(run.id, record);
      if (!line) continue;
      stdoutLineCount += 1;
      const stableTimestamp = parseRecordTimestamp(record);
      if (Number.isInteger(stableTimestamp)) {
        lastRecordTimestamp = stableTimestamp;
      }
      const parsedEvents = adapter.parseLine(line).map((event) => ({
        ...event,
        ...(Number.isInteger(stableTimestamp) ? { timestamp: stableTimestamp } : {}),
      }));
      normalizedEvents.push(...normalizeRunEvents(run, parsedEvents));
    }

    const flushedEvents = adapter.flush().map((event) => ({
      ...event,
      ...(Number.isInteger(lastRecordTimestamp) ? { timestamp: lastRecordTimestamp } : {}),
    }));
    normalizedEvents.push(...normalizeRunEvents(run, flushedEvents));

    const preview = spoolRecords
      .filter((record) => ['stdout', 'stderr', 'error'].includes(record.stream))
      .map((record) => {
        if (record?.json && typeof record.json === 'object') {
          try {
            return clipFailurePreview(JSON.stringify(record.json));
          } catch {}
        }
        return typeof record?.line === 'string' ? clipFailurePreview(record.line) : '';
      })
      .filter(Boolean)
      .slice(-3)
      .join(' | ');

    return {
      runtimeInvocation,
      normalizedEvents,
      stdoutLineCount,
      preview,
    };
  }

  async function syncDetachedRunUnlocked(sessionId, runId) {
    if (startupSyncDebug) {
      console.log(`[startup-sync] start runId=${runId} session=${sessionId}`);
    }
    let run = await getRun(runId);
    if (!run) {
      const cleared = (await mutateSessionMeta(sessionId, (session) => {
        if (session.activeRunId !== runId) return false;
        delete session.activeRunId;
        session.updatedAt = nowIso();
        return true;
      })).changed;
      if (cleared) {
        broadcastSessionInvalidation(sessionId);
      }
      stopObservedRun(runId);
      return null;
    }
    const manifest = await getRunManifest(runId);
    if (!manifest) return run;
    if (startupSyncDebug) {
      console.log(`[startup-sync] manifest loaded runId=${runId}`);
    }

    let historyChanged = false;
    let sessionChanged = false;

    const projection = await collectNormalizedRunEvents(run, manifest);
    const normalizedEvents = projection.normalizedEvents;
    if (startupSyncDebug) {
      console.log(`[startup-sync] projection done runId=${runId} events=${normalizedEvents.length}`);
    }
    const latestUsage = [...normalizedEvents].reverse().find((event) => event.type === 'usage');
    const contextInputTokens = Number.isInteger(latestUsage?.contextTokens)
      ? latestUsage.contextTokens
      : null;
    const contextWindowTokens = Number.isInteger(latestUsage?.contextWindowTokens)
      ? latestUsage.contextWindowTokens
      : null;

    run = await updateRun(runId, (current) => ({
      ...current,
      normalizedLineCount: projection.stdoutLineCount,
      normalizedEventCount: normalizedEvents.length,
      lastNormalizedAt: nowIso(),
      ...(Number.isInteger(contextInputTokens) ? { contextInputTokens } : {}),
      ...(Number.isInteger(contextWindowTokens) ? { contextWindowTokens } : {}),
    })) || run;

    if (run.claudeSessionId || run.codexThreadId) {
      sessionChanged = await persistResumeIds(sessionId, run.claudeSessionId, run.codexThreadId) || sessionChanged;
    }

    const isStructuredRuntime = projection.runtimeInvocation.isClaudeFamily || projection.runtimeInvocation.isCodexFamily;
    let result = await getRunResult(runId);
    const resultEnvelope = buildNormalizedRunResultEnvelope({
      result,
      normalizedEvents,
      parseTaskCardFromAssistantContent,
    });
    if (runResultEnvelopeHasMeaningfulContent(resultEnvelope)) {
      const mergedResult = mergeRunResultWithEnvelope(result, resultEnvelope);
      if (JSON.stringify(mergedResult) !== JSON.stringify(result || {})) {
        result = await writeRunResult(runId, mergedResult);
      } else {
        result = mergedResult;
      }
    }
    if (!isTerminalRunState(run.state) && !hasTerminalRunResult(result)) {
      const reconciled = await synthesizeDetachedRunTermination(runId, run, { result });
      if (reconciled) {
        run = reconciled;
        result = await getRunResult(runId);
      }
    }
    const inferredState = deriveRunStateFromResult(run, result);
    const completedAt = typeof result?.completedAt === 'string' && result.completedAt
      ? result.completedAt
      : null;
    const hasAssistantMessage = normalizedEvents.some((event) => event?.type === 'message' && event.role === 'assistant');
    const completedAtMs = completedAt ? Date.parse(completedAt) : NaN;
    const shouldWaitForStructuredOutput = (
      isStructuredRuntime
      && inferredState === 'completed'
      && (normalizedEvents.length === 0 || !hasAssistantMessage)
      && Number.isFinite(completedAtMs)
      && (Date.now() - completedAtMs) < structuredOutputSettleDelayMs
    );
    if (shouldWaitForStructuredOutput) {
      if (startupSyncDebug) {
        console.log(`[startup-sync] delaying finalization for structured output runId=${runId}`);
      }
      return run;
    }
    const zeroStructuredOutputReason = (
      isStructuredRuntime
      && inferredState === 'completed'
      && (normalizedEvents.length === 0 || !hasAssistantMessage)
    )
      ? await deriveStructuredRuntimeFailureReason(runId, projection.preview)
      : null;

    if (zeroStructuredOutputReason) {
      run = await updateRun(runId, (current) => ({
        ...current,
        state: 'failed',
        completedAt,
        result,
        failureReason: zeroStructuredOutputReason,
      })) || run;
    }

    const terminalFailureReason = isTerminalRunState(run.state) && run.state === 'failed'
      ? deriveRunFailureReasonFromResult(run, result)
      : null;
    if (terminalFailureReason && !run.failureReason) {
      run = await updateRun(runId, (current) => ({
        ...current,
        failureReason: terminalFailureReason,
      })) || run;
    }

    if (!isTerminalRunState(run.state) && inferredState && completedAt) {
      run = await updateRun(runId, (current) => ({
        ...current,
        state: inferredState,
        completedAt,
        result,
        failureReason: inferredState === 'failed'
          ? deriveRunFailureReasonFromResult(current, result)
          : null,
      })) || run;
    }

    if (isTerminalRunState(run.state) && !run.finalizedAt) {
      if (startupSyncDebug) {
        console.log(`[startup-sync] finalize start runId=${runId}`);
      }
      const finalized = await finalizeDetachedRun(sessionId, run, manifest, normalizedEvents);
      historyChanged = historyChanged || finalized.historyChanged;
      sessionChanged = sessionChanged || finalized.sessionChanged;
      run = await getRun(runId) || run;
      if (startupSyncDebug) {
        console.log(`[startup-sync] finalize done runId=${runId}`);
      }
    }

    if (historyChanged || sessionChanged) {
      broadcastSessionInvalidation(sessionId);
    }
    if (isTerminalRunState(run.state)) {
      const currentSession = await findSessionMeta(sessionId);
      if (getFollowUpQueueCount(currentSession) > 0) {
        void flushQueuedFollowUps(sessionId);
      }
    }
    if (isTerminalRunState(run.state) && run.finalizedAt) {
      stopObservedRun(runId);
    }
    return run;
  }

  async function syncDetachedRun(sessionId, runId) {
    if (!runId) return null;
    if (runSyncPromises.has(runId)) {
      return runSyncPromises.get(runId);
    }
    const promise = (async () => syncDetachedRunUnlocked(sessionId, runId))()
      .finally(() => {
        if (runSyncPromises.get(runId) === promise) {
          runSyncPromises.delete(runId);
        }
      });
    runSyncPromises.set(runId, promise);
    return promise;
  }

  function clearTrackedRunSync(runId = '') {
    if (!runId) return false;
    return runSyncPromises.delete(runId);
  }

  return {
    clearTrackedRunSync,
    collectNormalizedRunEvents,
    dropActiveRunGeneratedHistoryEvents,
    syncDetachedRun,
    withSyntheticSeqs,
  };
}
