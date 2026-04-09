import { normalizeAgentResultEnvelope } from '../../session-runtime/agent-result-envelope.mjs';
import { resolveSessionStateFromSession } from '../../session-runtime/session-state.mjs';

function buildRunTerminalStatusEvent(statusEvent, run) {
  if (run?.state === 'cancelled') {
    return {
      ...statusEvent('cancelled'),
      runId: run.id,
      ...(run.requestId ? { requestId: run.requestId } : {}),
    };
  }
  if (run?.state === 'failed' && run.failureReason) {
    return {
      ...statusEvent(`error: ${run.failureReason}`),
      runId: run.id,
      ...(run.requestId ? { requestId: run.requestId } : {}),
    };
  }
  return null;
}

function collectHookTraceMeta(...hookResults) {
  const seen = new Set();
  const hookIds = [];
  const hookLabels = [];
  let failureCount = 0;
  let traceAppendedCount = 0;

  for (const result of hookResults) {
    if (!result || typeof result !== 'object') continue;
    if (Array.isArray(result.failures)) {
      failureCount += result.failures.length;
    }
    if (Number.isInteger(result.traceAppendedCount) && result.traceAppendedCount > 0) {
      traceAppendedCount += result.traceAppendedCount;
    }
    const executed = Array.isArray(result.executed) ? result.executed : [];
    for (const hook of executed) {
      const hookId = String(hook?.id || '').trim();
      const hookLabel = String(hook?.label || hookId || '').trim();
      if (!hookLabel && !hookId) continue;
      const dedupeKey = hookId || hookLabel;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      if (hookId) hookIds.push(hookId);
      hookLabels.push(hookLabel || hookId);
    }
  }

  return {
    hookIds,
    hookLabels,
    failureCount,
    traceAppendedCount,
  };
}

function buildHookTraceStatusEvent(statusEvent, {
  hookIds = [],
  hookLabels = [],
  failureCount = 0,
  traceAppendedCount = 0,
} = {}) {
  if (traceAppendedCount > 0) return null;
  if (!Array.isArray(hookLabels) || hookLabels.length === 0) return null;
  const maxVisibleHooks = 8;
  const visibleLabels = hookLabels.slice(0, maxVisibleHooks);
  const visibleIds = Array.isArray(hookIds) ? hookIds.slice(0, maxVisibleHooks) : [];
  const overflow = Math.max(0, hookLabels.length - visibleLabels.length);
  let content = `hooks: ${visibleLabels.join(', ')}`;
  if (overflow > 0) content += ` (+${overflow})`;
  if (failureCount > 0) content += ` [${failureCount} failed]`;

  const event = {
    ...statusEvent(content),
    statusKind: 'hook_trace',
    hookCount: hookLabels.length,
    hookLabels: visibleLabels,
    hookIds: visibleIds,
  };
  if (overflow > 0) event.hookOverflow = overflow;
  if (failureCount > 0) event.hookFailures = failureCount;
  return event;
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeSuppressedBranchTitles(value) {
  const rawItems = Array.isArray(value)
    ? value
    : (typeof value === 'string' && value.trim() ? value.split(/\n+/) : []);
  const next = [];
  const seen = new Set();
  for (const raw of rawItems) {
    const normalized = normalizeText(raw);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(normalized);
    if (next.length >= 12) break;
  }
  return next;
}

function parseToolChainBreakSignal(value) {
  const normalized = normalizeText(value);
  const match = normalized.match(/^tool[_-]?chain[_-]?break\s*:\s*(.+)$/i);
  if (!match) return '';
  return normalizeText(match[1]) || '评价场景';
}

function mergeToolChainBreakCandidate(taskCard, branchTitle, suppressedBranchTitles = []) {
  if (!taskCard || typeof taskCard !== 'object' || Array.isArray(taskCard)) return taskCard;
  const normalizedTitle = normalizeText(branchTitle);
  if (!normalizedTitle) return taskCard;
  const suppressed = new Set(normalizeSuppressedBranchTitles(suppressedBranchTitles).map((entry) => entry.toLowerCase()));
  if (suppressed.has(normalizedTitle.toLowerCase())) return taskCard;

  const existing = Array.isArray(taskCard.candidateBranches) ? taskCard.candidateBranches : [];
  const normalizedExisting = new Set(existing.map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean));
  if (normalizedExisting.has(normalizedTitle.toLowerCase())) return taskCard;

  const candidates = [normalizedTitle, ...existing];
  return {
    ...taskCard,
    candidateBranches: candidates,
  };
}

const FINALIZE_DEBUG = process.env.MELODYSYNC_STARTUP_SYNC_DEBUG === '1';

function clearCompactionPendingFlags(liveSessions, {
  sessionId,
  workerCompaction,
  compactionTargetSessionId,
} = {}) {
  const live = liveSessions.get(sessionId);
  const targetLive = workerCompaction && compactionTargetSessionId
    ? liveSessions.get(compactionTargetSessionId)
    : live;
  if (targetLive) targetLive.pendingCompact = false;
  if (live && live !== targetLive) live.pendingCompact = false;
}

async function syncContinuityProjection({
  sessionId,
  getSession,
  syncSessionContinuityFromSession,
  taskCard,
  sessionState,
} = {}) {
  const sessionForContinuity = await getSession(sessionId);
  if (!sessionForContinuity) return;
  await syncSessionContinuityFromSession(sessionForContinuity, {
    taskCard: taskCard || sessionForContinuity.taskCard || null,
    sessionState: sessionState || sessionForContinuity.sessionState || null,
  }).catch((error) => {
    console.error(`[workbench] continuity sync ${sessionId}: ${error.message}`);
  });
}

export async function finalizeDetachedRunWithDeps(deps, {
  sessionId,
  run,
  manifest,
  normalizedEvents = [],
} = {}) {
  const {
    liveSessions,
    SESSION_ORGANIZER_INTERNAL_OPERATION,
    nowIso,
    sanitizeAssistantRunEvents,
    appendEvents,
    appendEvent,
    AUTO_COMPACT_MARKER_TEXT,
    createContextBarrierEvent,
    buildFallbackCompactionHandoff,
    messageEvent,
    statusEvent,
    findLatestAssistantMessageForRun,
    parseCompactionWorkerOutput,
    setContextHead,
    clearPersistedResumeIds,
    mutateSessionMeta,
    updateRun,
    findSessionMeta,
    stabilizeSessionTaskCard,
    updateSessionTaskCard,
    buildBranchCandidateStatusEvents,
    findLatestUserMessageSeqForRun,
    finalizeSessionOrganizerRun,
    broadcastSessionInvalidation,
    getSession,
    getSessionQueueCount,
    scheduleQueuedFollowUpDispatch,
    getFollowUpQueueCount,
    maybePublishRunResultAssets,
    syncSessionContinuityFromSession,
    emitHook,
    normalizeSessionTaskCard,
    maybeAutoCompact,
    applyCompactionWorkerResult,
  } = deps;

  let historyChanged = false;
  let sessionChanged = false;
  if (FINALIZE_DEBUG) {
    console.log(`[startup-finalize] start session=${sessionId} run=${run?.id}`);
  }
  const live = liveSessions.get(sessionId);
  const directCompaction = manifest?.internalOperation === 'context_compaction';
  const workerCompaction = manifest?.internalOperation === 'context_compaction_worker';
  const sessionOrganizing = manifest?.internalOperation === SESSION_ORGANIZER_INTERNAL_OPERATION;
  const compacting = directCompaction || workerCompaction;
  const compactionTargetSessionId = typeof manifest?.compactionTargetSessionId === 'string'
    ? manifest.compactionTargetSessionId
    : '';
  const {
    sanitizedEvents: finalizedEvents,
    latestTaskCard,
    latestGraphOps,
  } = sessionOrganizing
    ? { sanitizedEvents: normalizedEvents, latestTaskCard: null, latestGraphOps: null }
    : sanitizeAssistantRunEvents(normalizedEvents);
  if (FINALIZE_DEBUG) {
    console.log(`[startup-finalize] sanitized events=${Array.isArray(finalizedEvents) ? finalizedEvents.length : 0}`);
  }

  if (!sessionOrganizing && Array.isArray(finalizedEvents) && finalizedEvents.length > 0) {
    await appendEvents(sessionId, finalizedEvents);
    historyChanged = true;
  }
  if (FINALIZE_DEBUG) {
    console.log('[startup-finalize] appended events');
  }

  const terminalStatusEvent = !sessionOrganizing
    ? buildRunTerminalStatusEvent(statusEvent, run)
    : null;
  if (terminalStatusEvent) {
    await appendEvent(sessionId, terminalStatusEvent);
    historyChanged = true;
  }
  if (FINALIZE_DEBUG) {
    console.log('[startup-finalize] appended terminal status');
  }

  if (compacting) {
    clearCompactionPendingFlags(liveSessions, {
      sessionId,
      workerCompaction,
      compactionTargetSessionId,
    });

    if (workerCompaction && compactionTargetSessionId) {
      if (run.state === 'completed') {
        if (await applyCompactionWorkerResult(compactionTargetSessionId, run, manifest)) {
          historyChanged = true;
          sessionChanged = true;
        }
      } else if (run.state === 'failed' && run.failureReason) {
        await appendEvent(compactionTargetSessionId, statusEvent(`error: auto compress failed: ${run.failureReason}`));
        historyChanged = true;
      } else if (run.state === 'cancelled') {
        await appendEvent(compactionTargetSessionId, statusEvent('Auto Compress cancelled'));
        historyChanged = true;
      }
    } else if (directCompaction && run.state === 'completed') {
      const workerEvent = await findLatestAssistantMessageForRun(sessionId, run.id);
      const parsed = parseCompactionWorkerOutput(workerEvent?.content || '');
      const summary = parsed.summary;
      if (summary) {
        const barrierEvent = await appendEvent(sessionId, createContextBarrierEvent(AUTO_COMPACT_MARKER_TEXT, {
          automatic: false,
          compactionSessionId: sessionId,
        }));
        const handoffContent = parsed.handoff || buildFallbackCompactionHandoff(summary, '');
        const handoffEvent = await appendEvent(sessionId, messageEvent('assistant', handoffContent, undefined, {
          source: 'context_compaction_handoff',
          compactionRunId: run.id,
        }));
        const compactEvent = await appendEvent(sessionId, statusEvent('Context compacted — continue from the handoff below'));
        await setContextHead(sessionId, {
          mode: 'summary',
          summary: '',
          toolIndex: '',
          activeFromSeq: compactEvent.seq,
          compactedThroughSeq: compactEvent.seq,
          inputTokens: run.contextInputTokens || null,
          updatedAt: nowIso(),
          source: 'context_compaction',
          barrierSeq: barrierEvent.seq,
          handoffSeq: handoffEvent.seq,
          compactionSessionId: sessionId,
        });
        const cleared = await clearPersistedResumeIds(sessionId);
        sessionChanged = sessionChanged || cleared;
        historyChanged = true;
      }
    }
  }

  const finalizedMeta = await mutateSessionMeta(sessionId, (session) => {
    let changed = false;
    if (session.activeRunId === run.id) {
      delete session.activeRunId;
      changed = true;
    }
    if (!compacting) {
      if (run.claudeSessionId && session.claudeSessionId !== run.claudeSessionId) {
        session.claudeSessionId = run.claudeSessionId;
        changed = true;
      }
      if (run.codexThreadId && session.codexThreadId !== run.codexThreadId) {
        session.codexThreadId = run.codexThreadId;
        changed = true;
      }
    }
    if (changed) {
      session.updatedAt = nowIso();
    }
    return changed;
  });
  sessionChanged = sessionChanged || finalizedMeta.changed;

  const finalizedRun = await updateRun(run.id, (current) => ({
    ...current,
    finalizedAt: current.finalizedAt || nowIso(),
  })) || run;
  if (FINALIZE_DEBUG) {
    console.log('[startup-finalize] run finalized flag set');
  }

  let currentSessionMeta = finalizedMeta.meta || await findSessionMeta(sessionId);
  const previousTaskCard = normalizeSessionTaskCard(currentSessionMeta?.taskCard || null);
  const toolChainBreakCandidate = parseToolChainBreakSignal(finalizedRun?.failureReason);
  const stabilizedTaskCard = !sessionOrganizing && latestTaskCard
    ? stabilizeSessionTaskCard(currentSessionMeta, latestTaskCard)
    : null;
  const stabilizedTaskCardWithAutoCandidate = !sessionOrganizing && stabilizedTaskCard && toolChainBreakCandidate
    ? mergeToolChainBreakCandidate(
      stabilizedTaskCard,
      toolChainBreakCandidate,
      currentSessionMeta?.suppressedBranchTitles || [],
    )
    : stabilizedTaskCard;

  if (toolChainBreakCandidate) {
    const currentSignalCount = Number.isInteger(currentSessionMeta?.workflowSignals?.repeatedClarificationCount)
      ? currentSessionMeta.workflowSignals.repeatedClarificationCount
      : 0;
    const nextWorkflowSignals = {
      ...(currentSessionMeta?.workflowSignals || {}),
      repeatedClarificationCount: currentSignalCount + 1,
      lastRepeatedClarificationAt: nowIso(),
      lastRepeatedClarificationSignal: toolChainBreakCandidate,
      lastFailureReason: normalizeText(finalizedRun?.failureReason || ''),
    };
    const signalResult = await mutateSessionMeta(sessionId, (session) => {
      session.workflowSignals = nextWorkflowSignals;
      return true;
    });
    currentSessionMeta = signalResult?.meta || currentSessionMeta;
    sessionChanged = sessionChanged || signalResult?.changed === true;
  }

  let branchCandidateEvents = [];
  if (!sessionOrganizing && latestTaskCard) {
    if (FINALIZE_DEBUG) {
      console.log('[startup-finalize] updating task card');
    }
    const updatedTaskCard = await updateSessionTaskCard(sessionId, stabilizedTaskCardWithAutoCandidate);
    sessionChanged = sessionChanged || !!updatedTaskCard;
    branchCandidateEvents = buildBranchCandidateStatusEvents(finalizedRun, {
      sourceSeq: await findLatestUserMessageSeqForRun(sessionId, finalizedRun),
      previousTaskCard,
      nextTaskCard: stabilizedTaskCardWithAutoCandidate,
      suppressedBranchTitles: currentSessionMeta?.suppressedBranchTitles || [],
    });
    currentSessionMeta = updatedTaskCard || await findSessionMeta(sessionId) || currentSessionMeta;
  }

  const nextSessionState = !sessionOrganizing
    ? resolveSessionStateFromSession({
      ...(currentSessionMeta || {}),
      taskCard: currentSessionMeta?.taskCard || stabilizedTaskCard || null,
    })
    : null;

  const hasMeaningfulSessionState = nextSessionState && (
    nextSessionState.goal
    || nextSessionState.mainGoal
    || nextSessionState.checkpoint
    || nextSessionState.needsUser === true
    || nextSessionState.lineRole === 'branch'
    || nextSessionState.branchFrom
  );

  if (hasMeaningfulSessionState) {
    const sessionStateMeta = await mutateSessionMeta(sessionId, (session) => {
      const previousState = JSON.stringify(session?.sessionState || null);
      const nextState = JSON.stringify(nextSessionState);
      if (previousState === nextState) return false;
      session.sessionState = nextSessionState;
      session.updatedAt = nowIso();
      return true;
    });
    sessionChanged = sessionChanged || sessionStateMeta.changed;
  }

  if (!sessionOrganizing && !compacting) {
    if (FINALIZE_DEBUG) {
      console.log('[startup-finalize] syncing continuity');
    }
    await syncContinuityProjection({
      sessionId,
      getSession,
      syncSessionContinuityFromSession,
      taskCard: stabilizedTaskCard,
      sessionState: nextSessionState,
    });
  }

  if (sessionOrganizing) {
    if (run.state === 'completed') {
      const organized = await finalizeSessionOrganizerRun(sessionId, finalizedRun, normalizedEvents);
      sessionChanged = sessionChanged || organized.changed;
    }
    broadcastSessionInvalidation(sessionId);
    return { historyChanged, sessionChanged };
  }

  if (compacting) {
    if (workerCompaction && compactionTargetSessionId) {
      const targetSession = await getSession(compactionTargetSessionId);
      if (getSessionQueueCount(targetSession) > 0) {
        scheduleQueuedFollowUpDispatch(compactionTargetSessionId);
      }
      broadcastSessionInvalidation(compactionTargetSessionId);
    } else if (getFollowUpQueueCount(finalizedMeta.meta) > 0) {
      scheduleQueuedFollowUpDispatch(sessionId);
    }
    broadcastSessionInvalidation(sessionId);
    return { historyChanged, sessionChanged };
  }

  let latestSession = await getSession(sessionId);
  if (!latestSession) {
    return { historyChanged, sessionChanged };
  }
  if (FINALIZE_DEBUG) {
    console.log('[startup-finalize] resolved latest session');
  }

  const runEvent = finalizedRun.state === 'completed' ? 'run.completed' : 'run.failed';
  const completionNoticeKey = finalizedRun?.id ? `completion:run:${finalizedRun.id}` : '';
  const hookContext = {
    sessionId,
    session: latestSession,
    run: finalizedRun,
    resultEnvelope: normalizeAgentResultEnvelope(finalizedRun?.result || {}),
    events: finalizedEvents,
    taskCard: latestTaskCard,
    graphOps: latestGraphOps,
    graphOpResult: null,
    previousTaskCard,
    branchCandidateEvents,
    manifest,
    completionNoticeKey,
    appendEvent,
    statusEvent,
  };
  let branchSuggestedHookResult = null;
  if (branchCandidateEvents.length > 0) {
    branchSuggestedHookResult = await emitHook('branch.suggested', hookContext);
  }
  if (FINALIZE_DEBUG) {
    console.log('[startup-finalize] running hooks and asset publish');
  }
  const [assetsPublished, runLifecycleHookResult] = await Promise.all([
    maybePublishRunResultAssets(sessionId, finalizedRun, manifest, finalizedEvents),
    emitHook(runEvent, hookContext),
  ]);

  const hookTraceMeta = collectHookTraceMeta(
    branchSuggestedHookResult,
    runLifecycleHookResult,
  );
  const hookTraceEvent = buildHookTraceStatusEvent(statusEvent, hookTraceMeta);
  if (hookTraceEvent) {
    await appendEvent(sessionId, hookTraceEvent);
    historyChanged = true;
  }

  historyChanged = assetsPublished || historyChanged;

  if (branchCandidateEvents.length > 0) {
    historyChanged = true;
  }

  if (runEvent === 'run.completed') {
    if (FINALIZE_DEBUG) {
      console.log('[startup-finalize] maybeAutoCompact check');
    }
    latestSession = await getSession(sessionId);
    if (!latestSession) {
      return { historyChanged, sessionChanged };
    }
    if (await maybeAutoCompact(sessionId, latestSession, finalizedRun, manifest)) {
      historyChanged = true;
      latestSession = await getSession(sessionId);
      if (!latestSession) {
        return { historyChanged, sessionChanged };
      }
    }
  }

  if (getSessionQueueCount(latestSession) > 0) {
    scheduleQueuedFollowUpDispatch(sessionId);
  }
  if (FINALIZE_DEBUG) {
    console.log('[startup-finalize] done');
  }

  return { historyChanged, sessionChanged };
}
