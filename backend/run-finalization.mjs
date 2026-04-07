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
} = {}) {
  const sessionForContinuity = await getSession(sessionId);
  if (!sessionForContinuity) return;
  await syncSessionContinuityFromSession(sessionForContinuity, {
    taskCard: taskCard || sessionForContinuity.taskCard || null,
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
    statusEvent,
    findLatestAssistantMessageForRun,
    extractTaggedBlock,
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
  } = sessionOrganizing
    ? { sanitizedEvents: normalizedEvents, latestTaskCard: null }
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
      const summary = extractTaggedBlock(workerEvent?.content || '', 'summary');
      if (summary) {
        const compactEvent = await appendEvent(sessionId, statusEvent('Context compacted — next message will resume from summary'));
        await setContextHead(sessionId, {
          mode: 'summary',
          summary,
          activeFromSeq: compactEvent.seq,
          compactedThroughSeq: compactEvent.seq,
          inputTokens: run.contextInputTokens || null,
          updatedAt: nowIso(),
          source: 'context_compaction',
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

  const currentSessionMeta = finalizedMeta.meta || await findSessionMeta(sessionId);
  const stabilizedTaskCard = !sessionOrganizing && latestTaskCard
    ? stabilizeSessionTaskCard(currentSessionMeta, latestTaskCard)
    : null;

  let branchCandidateEvents = [];
  if (!sessionOrganizing && latestTaskCard) {
    if (FINALIZE_DEBUG) {
      console.log('[startup-finalize] updating task card');
    }
    const updatedTaskCard = await updateSessionTaskCard(sessionId, stabilizedTaskCard);
    sessionChanged = sessionChanged || !!updatedTaskCard;
    branchCandidateEvents = buildBranchCandidateStatusEvents(finalizedRun, {
      sourceSeq: await findLatestUserMessageSeqForRun(sessionId, finalizedRun),
      previousTaskCard: normalizeSessionTaskCard(currentSessionMeta?.taskCard || null),
      nextTaskCard: stabilizedTaskCard,
      suppressedBranchTitles: currentSessionMeta?.suppressedBranchTitles || [],
    });
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
  const hookContext = {
    sessionId,
    session: latestSession,
    run: finalizedRun,
    events: finalizedEvents,
    taskCard: latestTaskCard,
    previousTaskCard: normalizeSessionTaskCard(currentSessionMeta?.taskCard || null),
    branchCandidateEvents,
    manifest,
  };
  if (branchCandidateEvents.length > 0) {
    await emitHook('branch.suggested', hookContext);
  }
  if (FINALIZE_DEBUG) {
    console.log('[startup-finalize] running hooks and asset publish');
  }
  const [assetsPublished] = await Promise.all([
    maybePublishRunResultAssets(sessionId, finalizedRun, manifest, finalizedEvents),
    emitHook(runEvent, hookContext),
  ]);
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
