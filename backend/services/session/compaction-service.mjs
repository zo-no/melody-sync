async function buildCompactionSourcePayload(sessionId, {
  buildFallbackCompactionHandoff,
  buildToolActivityIndex,
  getContextHead,
  loadHistory,
  prepareConversationOnlyContinuationBody,
  uptoSeq = 0,
} = {}) {
  const [contextHead, history] = await Promise.all([
    getContextHead(sessionId),
    loadHistory(sessionId, { includeBodies: true }),
  ]);
  const targetSeq = uptoSeq > 0 ? uptoSeq : (history.at(-1)?.seq || 0);
  const boundedHistory = history.filter((event) => (event?.seq || 0) <= targetSeq);
  const activeFromSeq = Number.isInteger(contextHead?.activeFromSeq) ? contextHead.activeFromSeq : 0;
  const handoffSeq = Number.isInteger(contextHead?.handoffSeq) ? contextHead.handoffSeq : 0;
  const sliceEvents = boundedHistory.filter((event) => (event?.seq || 0) > activeFromSeq);
  const summary = typeof contextHead?.summary === 'string' ? contextHead.summary.trim() : '';
  const toolIndex = buildToolActivityIndex(boundedHistory);
  const handoffEvent = handoffSeq > 0
    ? boundedHistory.find((event) => (event?.seq || 0) === handoffSeq && event?.type === 'message')
    : null;
  const existingSummary = '';
  const existingHandoff = handoffEvent
    ? prepareConversationOnlyContinuationBody([handoffEvent])
    : (summary ? buildFallbackCompactionHandoff(summary, toolIndex) : '');
  const conversationBody = prepareConversationOnlyContinuationBody(sliceEvents);

  if (!existingSummary && !existingHandoff && !conversationBody && !toolIndex) {
    return null;
  }

  return {
    targetSeq,
    existingSummary,
    existingHandoff,
    conversationBody,
    toolIndex,
  };
}

async function findLatestAssistantMessageForRun(loadHistory, sessionId, runId) {
  const events = await loadHistory(sessionId, { includeBodies: true });
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'message' || event.role !== 'assistant') continue;
    if (runId && event.runId !== runId) continue;
    return event;
  }
  return null;
}

async function applyCompactionResult(targetSessionId, {
  appendEvent,
  autoCompactMarkerText,
  buildFallbackCompactionHandoff,
  clearPersistedResumeIds,
  compactionSessionId,
  compactedThroughSeq = null,
  completionStatusText,
  createContextBarrierEvent,
  handoff,
  inputTokens = null,
  messageEvent,
  nowIso,
  setContextHead,
  statusEvent,
  summary,
  toolIndex = '',
  automatic = false,
  runId = '',
} = {}) {
  if (!summary) {
    return {
      applied: false,
      sessionChanged: false,
    };
  }

  const barrierEvent = await appendEvent(targetSessionId, createContextBarrierEvent(autoCompactMarkerText, {
    automatic,
    compactionSessionId,
  }));
  const handoffContent = handoff || buildFallbackCompactionHandoff(summary, toolIndex);
  const handoffEvent = await appendEvent(targetSessionId, messageEvent('assistant', handoffContent, undefined, {
    source: 'context_compaction_handoff',
    compactionRunId: runId,
  }));
  const compactEvent = await appendEvent(targetSessionId, statusEvent(completionStatusText));

  await setContextHead(targetSessionId, {
    mode: 'summary',
    summary: '',
    toolIndex,
    activeFromSeq: compactEvent.seq,
    compactedThroughSeq: Number.isInteger(compactedThroughSeq) ? compactedThroughSeq : compactEvent.seq,
    inputTokens,
    updatedAt: nowIso(),
    source: 'context_compaction',
    barrierSeq: barrierEvent.seq,
    handoffSeq: handoffEvent.seq,
    compactionSessionId,
  });

  const clearedResumeIds = await clearPersistedResumeIds(targetSessionId);
  return {
    applied: true,
    sessionChanged: clearedResumeIds === true,
  };
}

export function createSessionCompactionService({
  appendEvent,
  autoCompactMarkerText,
  broadcastSessionInvalidation,
  buildContextCompactionPrompt,
  buildFallbackCompactionHandoff,
  buildToolActivityIndex,
  clearPersistedResumeIds,
  contextCompactorSystemPrompt,
  createContextBarrierEvent,
  createSession,
  enrichSessionMeta,
  ensureLiveSession,
  getAutoCompactContextTokens,
  getAutoCompactStatusText,
  getContextHead,
  getHistorySnapshot,
  getRunLiveContextTokens,
  getSession,
  getSessionQueueCount,
  internalSessionRoleContextCompactor,
  isContextCompactorSession,
  loadHistory,
  loadSessionsMeta,
  mutateSessionMeta,
  nowIso,
  messageEvent,
  parseCompactionWorkerOutput,
  prepareConversationOnlyContinuationBody,
  refreshCodexContextMetrics,
  sendMessage,
  setContextHead,
  startupSyncDebug,
  statusEvent,
}) {
  async function ensureContextCompactorSession(sourceSessionId, session, run) {
    const existingId = typeof session?.compactionSessionId === 'string' ? session.compactionSessionId.trim() : '';
    const effectiveTool = run?.tool || session.tool;
    if (existingId) {
      const existing = await getSession(existingId);
      if (existing) {
        if (effectiveTool && existing.tool !== effectiveTool) {
          await mutateSessionMeta(existing.id, (draft) => {
            draft.tool = effectiveTool;
            draft.updatedAt = nowIso();
            return true;
          });
        }
        return existing;
      }
    }

    const metas = await loadSessionsMeta();
    const linked = metas.find((meta) => meta.compactsSessionId === sourceSessionId && isContextCompactorSession(meta));
    if (linked) {
      await mutateSessionMeta(sourceSessionId, (draft) => {
        if (draft.compactionSessionId === linked.id) return false;
        draft.compactionSessionId = linked.id;
        draft.updatedAt = nowIso();
        return true;
      });
      return enrichSessionMeta(linked);
    }

    const created = await createSession(session.folder, effectiveTool, `auto-compress - ${session.name || 'session'}`, {
      sourceId: session.sourceId || '',
      sourceName: session.sourceName || '',
      systemPrompt: contextCompactorSystemPrompt,
      internalRole: internalSessionRoleContextCompactor,
      compactsSessionId: sourceSessionId,
      rootSessionId: session.rootSessionId || session.id,
    });
    if (!created) return null;

    await mutateSessionMeta(sourceSessionId, (draft) => {
      if (draft.compactionSessionId === created.id) return false;
      draft.compactionSessionId = created.id;
      draft.updatedAt = nowIso();
      return true;
    });

    return created;
  }

  async function queueContextCompaction(sessionId, session, run, { automatic = false } = {}) {
    const live = ensureLiveSession(sessionId);
    if (live.pendingCompact) return false;

    const snapshot = await getHistorySnapshot(sessionId);
    const compactionSource = await buildCompactionSourcePayload(sessionId, {
      buildFallbackCompactionHandoff,
      buildToolActivityIndex,
      getContextHead,
      loadHistory,
      prepareConversationOnlyContinuationBody,
      uptoSeq: snapshot.latestSeq,
    });
    if (!compactionSource) return false;

    const compactorSession = await ensureContextCompactorSession(sessionId, session, run);
    if (!compactorSession) return false;

    live.pendingCompact = true;

    const statusText = automatic
      ? getAutoCompactStatusText(run)
      : 'Auto Compress is condensing older context…';
    await appendEvent(sessionId, statusEvent(statusText));
    broadcastSessionInvalidation(sessionId);

    try {
      await sendMessage(compactorSession.id, buildContextCompactionPrompt({
        session,
        existingSummary: compactionSource.existingSummary,
        existingHandoff: compactionSource.existingHandoff,
        conversationBody: compactionSource.conversationBody,
        toolIndex: compactionSource.toolIndex,
        automatic,
      }), [], {
        tool: run?.tool || session.tool,
        model: run?.model || undefined,
        effort: run?.effort || undefined,
        thinking: false,
        recordUserMessage: false,
        queueIfBusy: false,
        freshThread: true,
        skipSessionContinuation: true,
        internalOperation: 'context_compaction_worker',
        compactionTargetSessionId: sessionId,
        compactionSourceSeq: compactionSource.targetSeq,
        compactionToolIndex: compactionSource.toolIndex,
        compactionReason: automatic ? 'automatic' : 'manual',
      });
      return true;
    } catch (error) {
      live.pendingCompact = false;
      await appendEvent(sessionId, statusEvent(`error: failed to compact context: ${error.message}`));
      broadcastSessionInvalidation(sessionId);
      return false;
    }
  }

  async function maybeAutoCompact(sessionId, session, run, manifest) {
    if (!session || !run || manifest?.internalOperation) return false;
    if (getSessionQueueCount(session) > 0) return false;
    if (startupSyncDebug) {
      console.log('[auto-compact] start', {
        sessionId,
        runId: run.id,
        codexThreadId: run.codexThreadId || null,
        contextInputTokens: run.contextInputTokens ?? null,
        contextWindowTokens: run.contextWindowTokens ?? null,
      });
    }
    let metricsBackedRun = run;
    const refreshed = await refreshCodexContextMetrics(run);
    if (refreshed) {
      if (startupSyncDebug) {
        console.log('[auto-compact] refreshed metrics', refreshed);
      }
      metricsBackedRun = {
        ...run,
        contextInputTokens: refreshed.contextTokens,
        ...(Number.isInteger(refreshed.contextWindowTokens)
          ? { contextWindowTokens: refreshed.contextWindowTokens }
          : {}),
      };
    }
    let contextTokens = getRunLiveContextTokens(metricsBackedRun);
    let autoCompactTokens = getAutoCompactContextTokens(metricsBackedRun);
    if (!Number.isInteger(contextTokens) || !Number.isFinite(autoCompactTokens)) {
      contextTokens = getRunLiveContextTokens(metricsBackedRun);
      autoCompactTokens = getAutoCompactContextTokens(metricsBackedRun);
    }
    if (startupSyncDebug) {
      console.log('[auto-compact] thresholds', {
        contextTokens,
        autoCompactTokens,
        contextWindowTokens: metricsBackedRun.contextWindowTokens ?? null,
      });
    }
    if (!Number.isInteger(contextTokens) || !Number.isFinite(autoCompactTokens)) return false;
    if (contextTokens <= autoCompactTokens) return false;
    if (startupSyncDebug) {
      console.log('[auto-compact] queueing compaction', {
        sessionId,
        runId: run.id,
      });
    }
    return queueContextCompaction(sessionId, session, metricsBackedRun, { automatic: true });
  }

  async function applyCompactionWorkerResult(targetSessionId, run, manifest) {
    const workerEvent = await findLatestAssistantMessageForRun(loadHistory, run.sessionId, run.id);
    const parsed = parseCompactionWorkerOutput(workerEvent?.content || '');
    const summary = parsed.summary;
    if (!summary) {
      await appendEvent(targetSessionId, statusEvent('error: failed to apply auto compress: compaction worker returned no <summary> block'));
      return {
        applied: false,
        sessionChanged: false,
      };
    }

    const applied = await applyCompactionResult(targetSessionId, {
      appendEvent,
      autoCompactMarkerText,
      automatic: manifest?.compactionReason === 'automatic',
      buildFallbackCompactionHandoff,
      clearPersistedResumeIds,
      compactedThroughSeq: Number.isInteger(manifest?.compactionSourceSeq) ? manifest.compactionSourceSeq : null,
      compactionSessionId: run.sessionId,
      completionStatusText: 'Auto Compress finished — continue from the handoff below',
      createContextBarrierEvent,
      handoff: parsed.handoff,
      inputTokens: run.contextInputTokens || null,
      messageEvent,
      nowIso,
      runId: run.id,
      setContextHead,
      statusEvent,
      summary,
      toolIndex: manifest?.compactionToolIndex || '',
    });
    return applied.applied
      ? { ...applied, sessionChanged: true }
      : applied;
  }

  async function applyDirectCompactionResult(sessionId, run) {
    const workerEvent = await findLatestAssistantMessageForRun(loadHistory, sessionId, run.id);
    const parsed = parseCompactionWorkerOutput(workerEvent?.content || '');
    const summary = parsed.summary;
    if (!summary) {
      return false;
    }

    return applyCompactionResult(sessionId, {
      appendEvent,
      autoCompactMarkerText,
      automatic: false,
      buildFallbackCompactionHandoff,
      clearPersistedResumeIds,
      compactedThroughSeq: null,
      compactionSessionId: sessionId,
      completionStatusText: 'Context compacted — continue from the handoff below',
      createContextBarrierEvent,
      handoff: parsed.handoff,
      inputTokens: run.contextInputTokens || null,
      messageEvent,
      nowIso,
      runId: run.id,
      setContextHead,
      statusEvent,
      summary,
      toolIndex: '',
    });
  }

  return {
    applyCompactionWorkerResult,
    applyDirectCompactionResult,
    maybeAutoCompact,
  };
}
