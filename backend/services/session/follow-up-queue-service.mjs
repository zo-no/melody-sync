export function createSessionFollowUpQueueService({
  broadcastSessionInvalidation,
  buildQueuedFollowUpDispatchText,
  buildQueuedFollowUpSourceContext,
  buildQueuedFollowUpTranscriptText,
  createInternalRequestId,
  ensureLiveSession,
  findSessionMeta,
  flushDetachedRunIfNeeded,
  followUpFlushDelayMs = 1500,
  getFollowUpQueue,
  getRun,
  isTerminalRunState,
  mutateSessionMeta,
  nowIso,
  removeDispatchedQueuedFollowUps,
  resolveQueuedFollowUpDispatchOptions,
  sanitizeQueuedFollowUpAttachments,
  submitHttpMessage,
  trimRecentFollowUpRequestIds,
}) {
  function clearFollowUpFlushTimer(sessionId) {
    const live = ensureLiveSession(sessionId);
    if (!live?.followUpFlushTimer) return false;
    clearTimeout(live.followUpFlushTimer);
    delete live.followUpFlushTimer;
    return true;
  }

  function clearFollowUpRuntimeState(sessionId) {
    const live = ensureLiveSession(sessionId);
    const hadTimer = clearFollowUpFlushTimer(sessionId);
    const hadPromise = Boolean(live?.followUpFlushPromise);
    delete live.followUpFlushPromise;
    return hadTimer || hadPromise;
  }

  async function flushQueuedFollowUps(sessionId) {
    const live = ensureLiveSession(sessionId);
    if (live.followUpFlushPromise) {
      return live.followUpFlushPromise;
    }

    const promise = (async () => {
      clearFollowUpFlushTimer(sessionId);

      const rawSession = await findSessionMeta(sessionId);
      if (!rawSession || rawSession.archived) return false;
      if (live.pendingCompact === true) {
        scheduleQueuedFollowUpDispatch(sessionId, followUpFlushDelayMs * 2);
        return false;
      }

      if (rawSession.activeRunId) {
        const activeRun = await flushDetachedRunIfNeeded(sessionId, rawSession.activeRunId) || await getRun(rawSession.activeRunId);
        if (activeRun && !isTerminalRunState(activeRun.state)) {
          scheduleQueuedFollowUpDispatch(sessionId, followUpFlushDelayMs * 2);
          return false;
        }
      }

      const queue = getFollowUpQueue(rawSession);
      if (queue.length === 0) return false;

      const requestIds = queue
        .map((entry) => (typeof entry?.requestId === 'string' ? entry.requestId.trim() : ''))
        .filter(Boolean);
      const dispatchText = buildQueuedFollowUpDispatchText(queue);
      const transcriptText = buildQueuedFollowUpTranscriptText(queue);
      const dispatchOptions = resolveQueuedFollowUpDispatchOptions(queue, rawSession);
      const queuedSourceContext = buildQueuedFollowUpSourceContext(queue);

      await submitHttpMessage(sessionId, dispatchText, [], {
        requestId: createInternalRequestId('queued_batch'),
        tool: dispatchOptions.tool,
        model: dispatchOptions.model,
        effort: dispatchOptions.effort,
        thinking: dispatchOptions.thinking,
        ...(queuedSourceContext ? { sourceContext: queuedSourceContext } : {}),
        preSavedAttachments: queue.flatMap((entry) => sanitizeQueuedFollowUpAttachments(entry.images)),
        recordedUserText: transcriptText,
        queueIfBusy: false,
      });

      const cleared = await mutateSessionMeta(sessionId, (session) => {
        const currentQueue = getFollowUpQueue(session);
        if (currentQueue.length === 0) return false;
        const nextQueue = removeDispatchedQueuedFollowUps(currentQueue, queue);
        if (nextQueue.length === currentQueue.length) {
          return false;
        }
        if (nextQueue.length > 0) {
          session.followUpQueue = nextQueue;
        } else {
          delete session.followUpQueue;
        }
        session.recentFollowUpRequestIds = trimRecentFollowUpRequestIds([
          ...(session.recentFollowUpRequestIds || []),
          ...requestIds,
        ]);
        session.updatedAt = nowIso();
        return true;
      });

      if (cleared.changed) {
        broadcastSessionInvalidation(sessionId);
      }
      return true;
    })().catch((error) => {
      console.error(`[follow-up-queue] failed to flush ${sessionId}: ${error.message}`);
      scheduleQueuedFollowUpDispatch(sessionId, followUpFlushDelayMs * 2);
      return false;
    }).finally(() => {
      const current = ensureLiveSession(sessionId);
      if (current?.followUpFlushPromise === promise) {
        delete current.followUpFlushPromise;
      }
    });

    live.followUpFlushPromise = promise;
    return promise;
  }

  function scheduleQueuedFollowUpDispatch(sessionId, delayMs = followUpFlushDelayMs) {
    const live = ensureLiveSession(sessionId);
    if (live.followUpFlushPromise) return true;
    clearFollowUpFlushTimer(sessionId);
    live.followUpFlushTimer = setTimeout(() => {
      const current = ensureLiveSession(sessionId);
      if (current?.followUpFlushTimer) {
        delete current.followUpFlushTimer;
      }
      void flushQueuedFollowUps(sessionId);
    }, delayMs);
    if (typeof live.followUpFlushTimer.unref === 'function') {
      live.followUpFlushTimer.unref();
    }
    return true;
  }

  return {
    clearFollowUpFlushTimer,
    clearFollowUpRuntimeState,
    flushQueuedFollowUps,
    scheduleQueuedFollowUpDispatch,
  };
}
