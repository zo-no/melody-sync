import { appendEvent, getHistorySnapshot } from '../../history.mjs';
import { messageEvent } from '../../normalizer.mjs';
import {
  createRun,
  findRunByRequest,
  getRun,
  isTerminalRunState,
  updateRun,
} from '../../run/store.mjs';
import { spawnDetachedRunner } from '../../run/supervisor.mjs';
import {
  buildTemporarySessionName,
  isSessionAutoRenamePending,
} from '../../session/naming.mjs';
import { saveAttachments } from './attachment-storage-service.mjs';
import { buildPrompt, resolveResumeState } from './prompt-service.mjs';

export function createSessionMessageSubmissionService({
  broadcastSessionInvalidation,
  clearRenameState,
  createInternalRequestId,
  emitHook,
  enrichSessionMeta,
  enrichSessionMetaForClient,
  ensureSessionFolderReady,
  ensureSessionManagerBuiltinHooksRegistered,
  findQueuedFollowUpByRequest,
  findSessionMeta,
  flushDetachedRunIfNeeded,
  getFollowUpQueue,
  getFollowUpQueueCount,
  getLiveSession,
  getSession,
  hasRecentFollowUpRequestId,
  mutateSessionMeta,
  normalizeSourceContext,
  nowIso,
  observeDetachedRun,
  renameSession,
  sanitizeQueuedFollowUpAttachments,
  sanitizeQueuedFollowUpOptions,
  scheduleQueuedFollowUpDispatch,
  shouldResetProviderResumeState,
  statusEvent,
  touchSessionMeta,
  updateSessionTool,
}) {
  async function submitHttpMessage(sessionId, text, images, options = {}) {
    ensureSessionManagerBuiltinHooksRegistered();
    const requestId = typeof options.requestId === 'string' ? options.requestId.trim() : '';
    if (!requestId) {
      throw new Error('requestId is required');
    }
    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new Error('text is required');
    }

    const existingRun = await findRunByRequest(sessionId, requestId);
    if (existingRun) {
      return {
        duplicate: true,
        queued: false,
        run: await getRun(existingRun.id) || existingRun,
        session: await getSession(sessionId),
      };
    }

    let session = await getSession(sessionId);
    let sessionMeta = await findSessionMeta(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.archived) {
      const error = new Error('Session is archived');
      error.code = 'SESSION_ARCHIVED';
      throw error;
    }

    const existingQueuedFollowUp = findQueuedFollowUpByRequest(sessionMeta, requestId);
    if (existingQueuedFollowUp || hasRecentFollowUpRequestId(sessionMeta, requestId)) {
      return {
        duplicate: true,
        queued: !!existingQueuedFollowUp,
        run: null,
        session: await getSession(sessionId, {
          includeQueuedMessages: !!existingQueuedFollowUp,
        }),
      };
    }

    const normalizedText = text.trim();

    let activeRun = null;
    let hasActiveRun = false;
    const hasPendingCompact = getLiveSession(sessionId)?.pendingCompact === true;
    const activeRunId = typeof sessionMeta?.activeRunId === 'string' ? sessionMeta.activeRunId : null;

    if (activeRunId) {
      activeRun = await flushDetachedRunIfNeeded(sessionId, activeRunId) || await getRun(activeRunId);
      if (activeRun && !isTerminalRunState(activeRun.state)) {
        hasActiveRun = true;
      }
      const refreshedSession = await getSession(sessionId);
      if (refreshedSession) {
        session = refreshedSession;
        sessionMeta = await findSessionMeta(sessionId) || sessionMeta;
      }
    }

    if ((hasActiveRun || hasPendingCompact || getFollowUpQueueCount(sessionMeta) > 0) && options.queueIfBusy !== false) {
      const queuedImages = options.preSavedAttachments?.length > 0
        ? sanitizeQueuedFollowUpAttachments(options.preSavedAttachments)
        : sanitizeQueuedFollowUpAttachments(await saveAttachments(images));
      const queuedOptions = sanitizeQueuedFollowUpOptions(options);
      const queuedEntry = {
        requestId,
        text: normalizedText,
        queuedAt: nowIso(),
        images: queuedImages,
        ...queuedOptions,
      };
      const queuedMeta = await mutateSessionMeta(sessionId, (draft) => {
        const queue = getFollowUpQueue(draft);
        if (queue.some((entry) => entry.requestId === requestId)) {
          return false;
        }
        draft.followUpQueue = [...queue, queuedEntry];
        draft.updatedAt = nowIso();
        return true;
      });
      const wasDuplicateQueueInsert = queuedMeta.changed === false;
      if (!hasActiveRun && !hasPendingCompact) {
        scheduleQueuedFollowUpDispatch(sessionId);
      }
      broadcastSessionInvalidation(sessionId);
      return {
        duplicate: wasDuplicateQueueInsert,
        queued: true,
        run: null,
        session: await getSession(sessionId, {
          includeQueuedMessages: true,
        }) || (queuedMeta.meta ? await enrichSessionMetaForClient(queuedMeta.meta, {
          includeQueuedMessages: true,
        }) : session),
      };
    }

    session = await ensureSessionFolderReady(sessionId, session);

    const snapshot = await getHistorySnapshot(sessionId);
    const previousTool = session.tool;
    const effectiveTool = options.tool || session.tool;
    if (await shouldResetProviderResumeState(effectiveTool, session, activeRun, options)) {
      options = { ...options, freshThread: true };
      const updatedResumeMeta = await mutateSessionMeta(sessionId, (draft) => {
        let changed = false;
        if (draft.codexThreadId) {
          delete draft.codexThreadId;
          changed = true;
        }
        if (draft.claudeSessionId) {
          delete draft.claudeSessionId;
          changed = true;
        }
        if (!changed) return false;
        draft.updatedAt = nowIso();
        return true;
      });
      if (updatedResumeMeta.meta) {
        session = await enrichSessionMeta(updatedResumeMeta.meta);
        sessionMeta = updatedResumeMeta.meta;
      }
    }
    const recordedUserText = typeof options.recordedUserText === 'string' && options.recordedUserText.trim()
      ? options.recordedUserText.trim()
      : normalizedText;
    const savedImages = options.preSavedAttachments?.length > 0
      ? sanitizeQueuedFollowUpAttachments(options.preSavedAttachments)
      : await saveAttachments(images);
    const sourceContext = normalizeSourceContext(options.sourceContext);
    const imageRefs = savedImages.map((img) => ({
      ...(img.filename ? { filename: img.filename } : {}),
      ...(img.savedPath ? { savedPath: img.savedPath } : {}),
      ...(img.assetId ? { assetId: img.assetId } : {}),
      ...(img.originalName ? { originalName: img.originalName } : {}),
      mimeType: img.mimeType,
    }));
    const isFirstRecordedUserMessage =
      options.recordUserMessage !== false
      && (snapshot.userMessageCount || 0) === 0;

    if (!options.internalOperation) {
      clearRenameState(sessionId);
    }
    const touchedSession = await touchSessionMeta(sessionId);
    if (touchedSession) {
      session = await enrichSessionMeta(touchedSession);
    }

    if (effectiveTool !== session.tool) {
      const updatedToolSession = await updateSessionTool(sessionId, effectiveTool);
      if (updatedToolSession) {
        session = updatedToolSession;
      }
    }

    const {
      claudeSessionId: persistedClaudeSessionId,
      codexThreadId: persistedCodexThreadId,
    } = resolveResumeState(effectiveTool, session, options);

    const run = await createRun({
      status: {
        sessionId,
        requestId,
        state: 'accepted',
        tool: effectiveTool,
        model: options.model || null,
        effort: options.effort || null,
        thinking: options.thinking === true,
        claudeSessionId: persistedClaudeSessionId,
        codexThreadId: persistedCodexThreadId,
        providerResumeId: persistedCodexThreadId || persistedClaudeSessionId || null,
        internalOperation: options.internalOperation || null,
        scheduledTriggerId: typeof options.scheduledTriggerId === 'string' && options.scheduledTriggerId
          ? options.scheduledTriggerId
          : null,
      },
      manifest: {
        sessionId,
        requestId,
        folder: session.folder,
        tool: effectiveTool,
        prompt: await buildPrompt(sessionId, session, normalizedText, previousTool, effectiveTool, snapshot, options),
        internalOperation: options.internalOperation || null,
        ...(typeof options.scheduledTriggerId === 'string' && options.scheduledTriggerId
          ? { scheduledTriggerId: options.scheduledTriggerId }
          : {}),
        ...(typeof options.compactionTargetSessionId === 'string' && options.compactionTargetSessionId
          ? { compactionTargetSessionId: options.compactionTargetSessionId }
          : {}),
        ...(Number.isInteger(options.compactionSourceSeq)
          ? { compactionSourceSeq: options.compactionSourceSeq }
          : {}),
        ...(typeof options.compactionToolIndex === 'string'
          ? { compactionToolIndex: options.compactionToolIndex }
          : {}),
        ...(typeof options.compactionReason === 'string' && options.compactionReason
          ? { compactionReason: options.compactionReason }
          : {}),
        options: {
          images: savedImages,
          thinking: options.thinking === true,
          model: options.model || undefined,
          effort: options.effort || undefined,
          claudeSessionId: persistedClaudeSessionId || undefined,
          codexThreadId: persistedCodexThreadId || undefined,
        },
      },
    });

    const activeSession = (await mutateSessionMeta(sessionId, (draft) => {
      draft.activeRunId = run.id;
      draft.updatedAt = nowIso();
      return true;
    })).meta;
    if (activeSession) {
      session = await enrichSessionMeta(activeSession);
    }

    if (options.recordUserMessage !== false) {
      const userEvent = messageEvent('user', recordedUserText, imageRefs.length > 0 ? imageRefs : undefined, {
        requestId,
        runId: run.id,
        ...(sourceContext ? { sourceContext } : {}),
      });
      await appendEvent(sessionId, userEvent);
      if (!options.internalOperation && isFirstRecordedUserMessage) {
        emitHook('session.first_user_message', {
          sessionId,
          session,
          run,
          userEvent,
          recordedUserText,
          manifest: null,
          appendEvent,
          statusEvent,
        }).catch(() => {});
      }
    }

    if (!options.internalOperation && isFirstRecordedUserMessage && isSessionAutoRenamePending(session)) {
      const draftName = buildTemporarySessionName(recordedUserText);
      if (draftName && draftName !== session.name) {
        const renamed = await renameSession(sessionId, draftName, {
          preserveAutoRename: true,
        });
        if (renamed) {
          session = renamed;
        }
      } else {
        const updatedMeta = await mutateSessionMeta(sessionId, (draft) => {
          if (draft.autoRenamePending !== true) return false;
          draft.autoRenamePending = false;
          draft.updatedAt = nowIso();
          return true;
        });
        if (updatedMeta.meta) {
          session = await enrichSessionMeta(updatedMeta.meta);
        }
      }
    }

    observeDetachedRun(sessionId, run.id);
    const spawned = spawnDetachedRunner(run.id);
    await updateRun(run.id, (current) => ({
      ...current,
      runnerProcessId: spawned?.pid || current.runnerProcessId || null,
    }));

    emitHook('run.started', {
      sessionId,
      session,
      run,
      manifest: null,
      appendEvent,
      statusEvent,
    }).catch(() => {});

    broadcastSessionInvalidation(sessionId);
    return {
      duplicate: false,
      queued: false,
      run: await getRun(run.id) || run,
      session: await getSession(sessionId) || session,
    };
  }

  async function sendMessage(sessionId, text, images, options = {}) {
    ensureSessionManagerBuiltinHooksRegistered();
    return submitHttpMessage(sessionId, text, images, {
      ...options,
      requestId: options.requestId || createInternalRequestId('compat'),
    });
  }

  return {
    sendMessage,
    submitHttpMessage,
  };
}
