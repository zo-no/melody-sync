import { randomBytes } from 'crypto';
import { watch } from 'fs';
import { dirname, join, resolve } from 'path';
import { createToolInvocation, resolveCwd } from '../process-runner.mjs';
import {
  appendEvent,
  appendEvents,
  clearSessionHistory,
  clearContextHead,
  clearForkContext,
  getContextHead,
  getHistorySnapshot,
  loadHistory,
  readEventsAfter,
  setForkContext,
  setContextHead,
} from '../history.mjs';
import { messageEvent, statusEvent } from '../normalizer.mjs';
import { emit as emitHook } from '../hooks/runtime/registry.mjs';
import { registerBuiltinHooks } from '../hooks/runtime/register-builtins.mjs';
import { createFollowUpQueueHelpers } from '../follow-up-queue.mjs';
import {
  buildSessionFolderUnavailableMessage,
  canonicalizeSessionFolder,
  inspectSessionFolder,
} from './folder.mjs';
import {
  buildSessionOrganizerPrompt,
  extractSessionOrganizerAssistantText,
  parseSessionOrganizerResult,
  SESSION_ORGANIZER_INTERNAL_OPERATION,
} from './organizer.mjs';
import { triggerSessionLabelSuggestion } from '../summarizer.mjs';
import {
  buildSessionContinuationContextFromBody,
} from './continuation.mjs';
import { broadcastSessionInvalidation, broadcastSessionsInvalidation } from './invalidation.mjs';
import {
  buildTemporarySessionName,
  normalizeSessionOrdinal,
  isSessionAutoRenamePending,
} from './naming.mjs';
import {
  didSessionWorkflowTransitionToDone,
  normalizeSessionWorkflowPriority,
  normalizeSessionWorkflowState,
  SESSION_WORKFLOW_STATE_WAITING_USER,
} from './workflow-state.mjs';
import {
  isContextCompactorSession,
  shouldExposeSession,
} from './visibility.mjs';
import { formatAttachmentContextLine } from '../attachment-utils.mjs';
import {
  buildContextCompactionPrompt,
  buildFallbackCompactionHandoff,
  buildToolActivityIndex,
  clipCompactionSection,
  parseCompactionWorkerOutput,
  prepareConversationOnlyContinuationBody,
} from '../session-runtime/session-compaction.mjs';
import {
  createRun,
  findRunByRequest,
  getRun,
  getRunManifest,
  getRunResult,
  isTerminalRunState,
  listRunIds,
  materializeRunSpoolLine,
  readRunSpoolRecords,
  requestRunCancel,
  runDir,
  updateRun,
  writeRunResult,
} from '../run/store.mjs';
import { readCodexSessionMetadata } from '../codex-session-metrics.mjs';
import { spawnDetachedRunner } from '../run/supervisor.mjs';
import {
  getSessionQueueCount,
  getSessionRunId,
  isSessionRunning,
} from './activity.mjs';
import {
  clipFailurePreview,
  collectRunOutputPreview,
  deriveRunFailureReasonFromResult,
  deriveRunStateFromResult,
  deriveStructuredRuntimeFailureReason,
  getAutoCompactContextTokens,
  getAutoCompactStatusText,
  getRunLiveContextTokens,
  refreshCodexContextMetrics,
  synthesizeDetachedRunTermination,
} from './run-health.mjs';
import {
  findSessionMeta,
  loadSessionsMeta,
  mutateSessionMeta,
  withSessionsMetaMutation,
} from './meta-store.mjs';
import { dispatchSessionEmailCompletionTargets, sanitizeEmailCompletionTargets } from '../../lib/agent-mail-completion-targets.mjs';
import { createSessionQueryHelpers } from '../models/session/queries/session-query.mjs';
import { resolveSavedAttachments, saveAttachments } from '../services/session/attachment-storage-service.mjs';
import { createSessionBranchingService } from '../services/session/branching-service.mjs';
import { createSessionWithDeps } from '../services/session/creation-service.mjs';
import { createDetachedRunObserverService } from '../services/session/detached-run-observer-service.mjs';
import {
  assertSessionCanBeDeletedPermanently,
  buildPermanentSessionDeletionPlan,
  deletePermanentSessionArtifacts,
  deleteSessionTreeMetadata,
  writePermanentSessionDeletionJournal,
} from '../services/session/deletion-service.mjs';
import { createSessionMetadataMutationService } from '../services/session/metadata-service.mjs';
import { createSessionMessageSubmissionService } from '../services/session/message-submission-service.mjs';
import { createSessionPersistentService } from '../services/session/persistent-service.mjs';
import { buildPrompt, resolveResumeState } from '../services/session/prompt-service.mjs';
import { createSessionWorkflowRuntimeService } from '../services/session/workflow-runtime-service.mjs';
import {
  normalizeSessionSourceName,
  normalizeSessionUserName,
} from '../session-source/meta-fields.mjs';
import { publishLocalFileAssetFromPath } from '../file-assets.mjs';
import { statOrNull } from '../fs-utils.mjs';
import {
  buildResultAssetReadyMessage,
  collectGeneratedResultFilesFromRun,
  normalizePublishedResultAssetAttachments,
  resolveAttachmentMimeType,
  sanitizeOriginalAttachmentName,
} from '../result-assets.mjs';
import {
  parseGraphOpsFromAssistantContent,
} from './graph-ops.mjs';
import {
  normalizeSessionTaskCard,
  parseTaskCardFromAssistantContent,
  stripTaskCardFromAssistantContent,
} from './task-card.mjs';
import {
  buildNormalizedRunResultEnvelope,
  mergeRunResultWithEnvelope,
  runResultEnvelopeHasMeaningfulContent,
} from '../run/result-envelope.mjs';
import { finalizeDetachedRunWithDeps } from '../run/finalization.mjs';
import { registerSessionManagerBuiltinHooks } from '../hooks/runtime/register-session-manager-hooks.mjs';
import { syncSessionContinuityFromSession } from '../workbench/index.mjs';

const INTERNAL_SESSION_ROLE_CONTEXT_COMPACTOR = 'context_compactor';
const INTERNAL_SESSION_ROLE_AGENT_DELEGATE = 'agent_delegate';
const AUTO_COMPACT_MARKER_TEXT = 'Older messages above this marker are no longer in the model\'s live context. They remain visible in the transcript, but only the compressed handoff and newer messages below are loaded for continued work.';
const CONTEXT_COMPACTOR_SYSTEM_PROMPT = [
  'You are MelodySync\'s hidden context compactor for a user-facing session.',
  'Your job is to condense older session context into a compact continuation package.',
  'Preserve the task objective, accepted decisions, constraints, completed work, current state, open questions, and next steps.',
  'Do not include raw tool dumps unless a tiny excerpt is essential.',
  'Be explicit about what is no longer in live context and what the next worker should rely on.',
].join('\n');

const FOLLOW_UP_FLUSH_DELAY_MS = 1500;
const MAX_RECENT_FOLLOW_UP_REQUEST_IDS = 100;
const OBSERVED_RUN_POLL_INTERVAL_MS = 250;
const STRUCTURED_OUTPUT_SETTLE_DELAY_MS = 1000;
const RESULT_FILE_MAX_ATTACHMENTS = 4;
const RESULT_FILE_COMMAND_OUTPUT_FLAGS = new Set(['-o', '--output', '--out', '--export']);
const STARTUP_SYNC_DEBUG = process.env.MELODYSYNC_STARTUP_SYNC_DEBUG === '1';
const {
  getFollowUpQueue,
  getFollowUpQueueCount,
  sanitizeQueuedFollowUpAttachments,
  sanitizeQueuedFollowUpOptions,
  buildQueuedFollowUpSourceContext,
  serializeQueuedFollowUp,
  removeDispatchedQueuedFollowUps,
  trimRecentFollowUpRequestIds,
  hasRecentFollowUpRequestId,
  findQueuedFollowUpByRequest,
  buildQueuedFollowUpTranscriptText,
  buildQueuedFollowUpDispatchText,
  resolveQueuedFollowUpDispatchOptions,
} = createFollowUpQueueHelpers({
  normalizeSourceContext,
  sanitizeOriginalAttachmentName,
  resolveAttachmentMimeType,
  formatAttachmentContextLine,
  maxRecentFollowUpRequestIds: MAX_RECENT_FOLLOW_UP_REQUEST_IDS,
});
const {
  buildSessionTimelineEvents,
  enrichSessionMeta,
  enrichSessionMetaForClient,
  flushDetachedRunIfNeeded,
  reconcileSessionMeta,
  reconcileSessionsMetaList,
  listSessions: listSessionsQuery,
  getSession: getSessionQuery,
  getSessionEventsAfter: getSessionEventsAfterQuery,
  getSessionTimelineEvents: getSessionTimelineEventsQuery,
  getSessionSourceContext: getSessionSourceContextQuery,
  getHistory: getHistoryQuery,
} = createSessionQueryHelpers({
  getLiveSession: (sessionId) => liveSessions.get(sessionId),
  getFollowUpQueue,
  getFollowUpQueueCount,
  serializeQueuedFollowUp,
  normalizeSourceContext,
  stabilizeSessionTaskCard,
  syncDetachedRun,
  collectNormalizedRunEvents,
  dropActiveRunGeneratedHistoryEvents,
  withSyntheticSeqs,
  organizerInternalOperation: SESSION_ORGANIZER_INTERNAL_OPERATION,
});

function getNextSessionOrdinal(metas = []) {
  return (Array.isArray(metas) ? metas : []).reduce(
    (maxOrdinal, entry) => Math.max(maxOrdinal, normalizeSessionOrdinal(entry?.ordinal)),
    0,
  ) + 1;
}

function normalizeSuppressedBranchTitles(value) {
  const rawItems = Array.isArray(value)
    ? value
    : (typeof value === 'string' && value.trim() ? value.split(/\n+/) : []);
  const next = [];
  const seen = new Set();
  for (const raw of rawItems) {
    const normalized = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(normalized.slice(0, 120));
    if (next.length >= 12) break;
  }
  return next;
}

const liveSessions = new Map();
const observedRuns = new Map();
const runSyncPromises = new Map();
const MAX_SESSION_SOURCE_CONTEXT_BYTES = 16 * 1024;

function nowIso() {
  return new Date().toISOString();
}

export { buildPrompt, resolveResumeState };

async function resolveLatestCompletedRunIdForSession(sessionId = '') {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) return '';
  const runIds = await listRunIds();
  let latestRunId = '';
  let latestTimestamp = '';
  for (const runId of runIds) {
    const run = await getRun(runId);
    if (!run || run.sessionId !== normalizedSessionId || run.state !== 'completed') continue;
    const completedAt = typeof run.completedAt === 'string' ? run.completedAt : '';
    const updatedAt = typeof run.updatedAt === 'string' ? run.updatedAt : '';
    const candidateTimestamp = completedAt || updatedAt;
    if (!candidateTimestamp) continue;
    if (!latestTimestamp || candidateTimestamp > latestTimestamp) {
      latestTimestamp = candidateTimestamp;
      latestRunId = run.id;
    }
  }
  return latestRunId;
}

function buildSessionCompletionNoticeKey(sessionId = '', runId = '') {
  const normalizedSessionId = String(sessionId || '').trim();
  const normalizedRunId = String(runId || '').trim();
  if (normalizedSessionId && normalizedRunId) return `completion:run:${normalizedRunId}`;
  if (normalizedSessionId) return `completion:session:${normalizedSessionId}:done`;
  return '';
}

function normalizeSourceContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    if (!serialized || serialized === '{}' || Buffer.byteLength(serialized, 'utf8') > MAX_SESSION_SOURCE_CONTEXT_BYTES) {
      return null;
    }
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

function generateId() {
  return randomBytes(16).toString('hex');
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function ensureSessionFolderReady(sessionId, session) {
  const folderState = inspectSessionFolder(session?.folder || '', {
    allowPersistentFallback: Boolean(session?.persistent),
  });
  if (!folderState.available) {
    const error = new Error(buildSessionFolderUnavailableMessage(session?.folder || ''));
    error.code = 'SESSION_FOLDER_UNAVAILABLE';
    error.statusCode = 409;
    throw error;
  }

  if (!folderState.changed || !folderState.storedFolder) {
    return session;
  }

  const updatedFolderMeta = await mutateSessionMeta(sessionId, (draft) => {
    if ((draft?.folder || '') === folderState.storedFolder) return false;
    draft.folder = folderState.storedFolder;
    draft.updatedAt = nowIso();
    return true;
  });

  if (updatedFolderMeta.meta) {
    const nextSession = await enrichSessionMeta(updatedFolderMeta.meta);
    if (nextSession) return nextSession;
  }

  return {
    ...session,
    folder: folderState.storedFolder,
  };
}

function pushUnique(values, candidate) {
  const normalized = trimString(candidate);
  if (!normalized || values.includes(normalized)) return false;
  values.push(normalized);
  return true;
}

function clearFollowUpFlushTimer(sessionId) {
  const live = liveSessions.get(sessionId);
  if (!live?.followUpFlushTimer) return false;
  clearTimeout(live.followUpFlushTimer);
  delete live.followUpFlushTimer;
  return true;
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

    if (rawSession.activeRunId) {
      const activeRun = await flushDetachedRunIfNeeded(sessionId, rawSession.activeRunId) || await getRun(rawSession.activeRunId);
      if (activeRun && !isTerminalRunState(activeRun.state)) {
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
    scheduleQueuedFollowUpDispatch(sessionId, FOLLOW_UP_FLUSH_DELAY_MS * 2);
    return false;
  }).finally(() => {
    const current = liveSessions.get(sessionId);
    if (current?.followUpFlushPromise === promise) {
      delete current.followUpFlushPromise;
    }
  });

  live.followUpFlushPromise = promise;
  return promise;
}

function scheduleQueuedFollowUpDispatch(sessionId, delayMs = FOLLOW_UP_FLUSH_DELAY_MS) {
  const live = ensureLiveSession(sessionId);
  if (live.followUpFlushPromise) return true;
  clearFollowUpFlushTimer(sessionId);
  live.followUpFlushTimer = setTimeout(() => {
    const current = liveSessions.get(sessionId);
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

function createInternalRequestId(prefix = 'internal') {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}

const {
  delegateSession: delegateSessionViaBranchingService,
  forkSession: forkSessionViaBranchingService,
} = createSessionBranchingService({
  broadcastSessionInvalidation,
  broadcastSessionsInvalidation,
  createInternalRequestId,
  createSession,
  getSession,
  internalSessionRoleAgentDelegate: INTERNAL_SESSION_ROLE_AGENT_DELEGATE,
  isSessionRunning,
  nowIso,
  submitHttpMessage,
});

const {
  renameSession: renameSessionViaMetadataService,
  setSessionArchived: setSessionArchivedViaMetadataService,
  setSessionPinned: setSessionPinnedViaMetadataService,
  updateSessionAgreements: updateSessionAgreementsViaMetadataService,
  updateSessionGrouping: updateSessionGroupingViaMetadataService,
  updateSessionLastReviewedAt: updateSessionLastReviewedAtViaMetadataService,
  updateSessionTaskCard: updateSessionTaskCardViaMetadataService,
} = createSessionMetadataMutationService({
  broadcastSessionInvalidation,
  broadcastSessionsInvalidation,
  clearRenameState,
  enrichSessionMeta,
  findSessionMeta,
  mutateSessionMeta,
  nowIso,
  stabilizeSessionTaskCard,
});

const {
  updateSessionRuntimePreferences: updateSessionRuntimePreferencesViaWorkflowRuntimeService,
  updateSessionTool: updateSessionToolViaWorkflowRuntimeService,
  updateSessionWorkflowClassification: updateSessionWorkflowClassificationViaWorkflowRuntimeService,
} = createSessionWorkflowRuntimeService({
  appendEvent,
  broadcastSessionInvalidation,
  broadcastSessionsInvalidation,
  buildSessionCompletionNoticeKey,
  didSessionWorkflowTransitionToDone,
  emitHook,
  enrichSessionMeta,
  getSession,
  mutateSessionMeta,
  normalizeSessionWorkflowPriority,
  normalizeSessionWorkflowState,
  nowIso,
  resolveLatestCompletedRunIdForSession,
  sessionWorkflowStateWaitingUser: SESSION_WORKFLOW_STATE_WAITING_USER,
  shouldExposeSession,
  statusEvent,
});

const {
  promoteSessionToPersistent: promoteSessionToPersistentViaPersistentService,
  runSessionPersistent: runSessionPersistentViaPersistentService,
  updateSessionPersistent: updateSessionPersistentViaPersistentService,
} = createSessionPersistentService({
  broadcastSessionInvalidation,
  createInternalRequestId,
  createSession,
  enrichSessionMeta,
  getSession,
  getSessionQueueCount,
  isSessionRunning,
  mutateSessionMeta,
  nowIso,
  submitHttpMessage,
});

function ensureLiveSession(sessionId) {
  let live = liveSessions.get(sessionId);
  if (!live) {
    live = {};
    liveSessions.set(sessionId, live);
  }
  return live;
}

function parseRecordTimestamp(record) {
  const parsed = Date.parse(record?.ts || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function isUserMessageEvent(event) {
  return event?.type === 'message' && event.role === 'user';
}

function dropActiveRunGeneratedHistoryEvents(history = [], activeRunId = '') {
  if (!activeRunId) return Array.isArray(history) ? history : [];
  return (Array.isArray(history) ? history : []).filter((event) => {
    if (event?.runId !== activeRunId) return true;
    return isUserMessageEvent(event);
  });
}

function withSyntheticSeqs(events = [], baseSeq = 0) {
  let nextSeq = Number.isInteger(baseSeq) && baseSeq > 0 ? baseSeq : 0;
  return (Array.isArray(events) ? events : []).map((event) => {
    nextSeq += 1;
    return {
      ...event,
      seq: nextSeq,
    };
  });
}

async function collectNormalizedRunEvents(run, manifest) {
  const runtimeInvocation = await createToolInvocation(manifest.tool, '', {
    model: manifest.options?.model,
    effort: manifest.options?.effort,
    thinking: manifest.options?.thinking,
  });
  const { adapter } = runtimeInvocation;
  const spoolRecords = await readRunSpoolRecords(run.id);
  if (STARTUP_SYNC_DEBUG) {
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
  if (STARTUP_SYNC_DEBUG) {
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
  if (STARTUP_SYNC_DEBUG) {
    console.log(`[startup-sync] manifest loaded runId=${runId}`);
  }

  let historyChanged = false;
  let sessionChanged = false;

  const projection = await collectNormalizedRunEvents(run, manifest);
  const normalizedEvents = projection.normalizedEvents;
  if (STARTUP_SYNC_DEBUG) {
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
  if (!result && !isTerminalRunState(run.state)) {
    const reconciled = await synthesizeDetachedRunTermination(runId, run);
    if (reconciled) {
      run = reconciled;
      result = await getRunResult(runId);
    }
  }
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
    && (Date.now() - completedAtMs) < STRUCTURED_OUTPUT_SETTLE_DELAY_MS
  );
  if (shouldWaitForStructuredOutput) {
    if (STARTUP_SYNC_DEBUG) {
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

  if (!isTerminalRunState(run.state)) {
    if (inferredState && completedAt) {
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
  }

  if (isTerminalRunState(run.state) && !run.finalizedAt) {
    if (STARTUP_SYNC_DEBUG) {
      console.log(`[startup-sync] finalize start runId=${runId}`);
    }
    const finalized = await finalizeDetachedRun(sessionId, run, manifest, normalizedEvents);
    historyChanged = historyChanged || finalized.historyChanged;
    sessionChanged = sessionChanged || finalized.sessionChanged;
    run = await getRun(runId) || run;
    if (STARTUP_SYNC_DEBUG) {
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

export { resolveSavedAttachments, saveAttachments };

async function touchSessionMeta(sessionId, extra = {}) {
  return (await mutateSessionMeta(sessionId, (session) => {
    session.updatedAt = nowIso();
    Object.assign(session, extra);
    return true;
  })).meta;
}

function queueSessionCompletionTargets(session, run, manifest) {
  if (!session?.id || !run?.id || manifest?.internalOperation) return false;
  const targets = sanitizeEmailCompletionTargets(session.completionTargets || []);
  if (targets.length === 0) return false;
  dispatchSessionEmailCompletionTargets({
    ...session,
    completionTargets: targets,
  }, run).catch((error) => {
    console.error(`[agent-mail-completion-targets] ${session.id}/${run.id}: ${error.message}`);
  });
  return true;
}

async function resumePendingCompletionTargets() {
  for (const runId of await listRunIds()) {
    const run = await getRun(runId);
    if (!run || !isTerminalRunState(run.state)) continue;
    const session = await getSession(run.sessionId);
    if (!session?.completionTargets?.length) continue;
    const manifest = await getRunManifest(runId);
    if (manifest?.internalOperation) continue;
    queueSessionCompletionTargets(session, run, manifest);
  }
}

async function persistResumeIds(sessionId, claudeSessionId, codexThreadId) {
  return (await mutateSessionMeta(sessionId, (session) => {
    let changed = false;
    if (claudeSessionId && session.claudeSessionId !== claudeSessionId) {
      session.claudeSessionId = claudeSessionId;
      changed = true;
    }
    if (codexThreadId && session.codexThreadId !== codexThreadId) {
      session.codexThreadId = codexThreadId;
      changed = true;
    }
    if (changed) {
      session.updatedAt = nowIso();
    }
    return changed;
  })).changed;
}

async function clearPersistedResumeIds(sessionId) {
  return (await mutateSessionMeta(sessionId, (session) => {
    let changed = false;
    if (session.claudeSessionId) {
      delete session.claudeSessionId;
      changed = true;
    }
    if (session.codexThreadId) {
      delete session.codexThreadId;
      changed = true;
    }
    if (changed) {
      session.updatedAt = nowIso();
    }
    return changed;
  })).changed;
}

function clearRenameState(sessionId, { broadcast = false } = {}) {
  const live = liveSessions.get(sessionId);
  if (!live) return false;
  const hadState = !!live.renameState || !!live.renameError;
  delete live.renameState;
  delete live.renameError;
  if (hadState && broadcast) {
    broadcastSessionInvalidation(sessionId);
  }
  return hadState;
}

export { broadcastSessionInvalidation, broadcastSessionsInvalidation };

function createContextBarrierEvent(content, extra = {}) {
  return {
    type: 'context_barrier',
    role: 'system',
    id: `evt_${randomBytes(8).toString('hex')}`,
    timestamp: Date.now(),
    content,
    ...extra,
  };
}

async function buildCompactionSourcePayload(sessionId, session, { uptoSeq = 0 } = {}) {
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

async function ensureContextCompactorSession(sourceSessionId, session, run) {
  const existingId = typeof session?.compactionSessionId === 'string' ? session.compactionSessionId.trim() : '';
  if (existingId) {
    const existing = await getSession(existingId);
    if (existing) {
      if ((run?.tool || session.tool) && existing.tool !== (run?.tool || session.tool)) {
        await mutateSessionMeta(existing.id, (draft) => {
          draft.tool = run?.tool || session.tool;
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

  const created = await createSession(session.folder, run?.tool || session.tool, `auto-compress - ${session.name || 'session'}`, {
    sourceId: session.sourceId || '',
    sourceName: session.sourceName || '',
    systemPrompt: CONTEXT_COMPACTOR_SYSTEM_PROMPT,
    internalRole: INTERNAL_SESSION_ROLE_CONTEXT_COMPACTOR,
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

async function findLatestAssistantMessageForRun(sessionId, runId) {
  const events = await loadHistory(sessionId, { includeBodies: true });
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'message' || event.role !== 'assistant') continue;
    if (runId && event.runId !== runId) continue;
    return event;
  }
  return null;
}

async function findResultAssetMessageForRun(sessionId, runId) {
  const events = await loadHistory(sessionId, { includeBodies: false });
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'message' || event.role !== 'assistant') continue;
    if (event?.source !== 'result_file_assets') continue;
    if (event?.resultRunId !== runId) continue;
    return event;
  }
  return null;
}

async function applySessionOrganizerPatch(sessionId, patch = {}) {
  let session = await getSession(sessionId);
  if (!session) return null;

  const nextName = typeof patch?.name === 'string' ? patch.name.trim() : '';
  if (nextName && nextName !== session.name) {
    session = await renameSession(sessionId, nextName) || session;
  }

  const nextGroup = typeof patch?.group === 'string' ? patch.group : '';
  const nextDescription = typeof patch?.description === 'string' ? patch.description : '';
  if ((nextGroup && nextGroup !== (session.group || '')) || (nextDescription && nextDescription !== (session.description || ''))) {
    session = await updateSessionGrouping(sessionId, {
      ...(nextGroup ? { group: nextGroup } : {}),
      ...(nextDescription ? { description: nextDescription } : {}),
    }) || session;
  }

  const nextWorkflowState = typeof patch?.workflowState === 'string' ? patch.workflowState : '';
  const nextWorkflowPriority = typeof patch?.workflowPriority === 'string' ? patch.workflowPriority : '';
  if (
    (nextWorkflowState && nextWorkflowState !== (session.workflowState || ''))
    || (nextWorkflowPriority && nextWorkflowPriority !== (session.workflowPriority || ''))
  ) {
    session = await updateSessionWorkflowClassification(sessionId, {
      ...(nextWorkflowState ? { workflowState: nextWorkflowState } : {}),
      ...(nextWorkflowPriority ? { workflowPriority: nextWorkflowPriority } : {}),
    }) || session;
  }

  return session;
}

async function finalizeSessionOrganizerRun(sessionId, run, normalizedEvents = []) {
  const assistantText = extractSessionOrganizerAssistantText(normalizedEvents);
  if (!assistantText) {
    await updateRun(run.id, (current) => ({
      ...current,
      state: 'failed',
      failureReason: 'Session organizer produced no assistant output',
    }));
    return { session: await getSession(sessionId), changed: false };
  }

  const parsed = parseSessionOrganizerResult(assistantText);
  if (!parsed.ok) {
    await updateRun(run.id, (current) => ({
      ...current,
      state: 'failed',
      failureReason: 'Session organizer returned invalid JSON',
    }));
    return { session: await getSession(sessionId), changed: false };
  }

  const before = await getSession(sessionId);
  const updated = await applySessionOrganizerPatch(sessionId, parsed);
  const changed = JSON.stringify({
    name: before?.name || '',
    group: before?.group || '',
    description: before?.description || '',
    workflowState: before?.workflowState || '',
    workflowPriority: before?.workflowPriority || '',
  }) !== JSON.stringify({
    name: updated?.name || '',
    group: updated?.group || '',
    description: updated?.description || '',
    workflowState: updated?.workflowState || '',
    workflowPriority: updated?.workflowPriority || '',
  });

  return {
    session: updated || before,
    changed,
  };
}

async function triggerAutomaticSessionLabeling(sessionId, session) {
  const currentSession = await getSession(sessionId) || session;
  if (!currentSession || !isSessionAutoRenamePending(currentSession)) {
    return {
      ok: true,
      skipped: 'session_labels_not_needed',
      rename: { attempted: false, renamed: false },
    };
  }
  if (getSessionQueueCount(currentSession) > 0) {
    return {
      ok: true,
      skipped: 'queued_follow_ups_present',
      rename: { attempted: false, renamed: false },
    };
  }

  const outcome = await triggerSessionLabelSuggestion(
    currentSession,
    async (newName) => !!(await renameSession(sessionId, newName)),
    { skipReason: 'Auto-rename no longer needed' },
  );

  const summary = outcome?.summary;
  if (summary && (summary.group || summary.description)) {
    await updateSessionGrouping(sessionId, {
      ...(summary.group ? { group: summary.group } : {}),
      ...(summary.description ? { description: summary.description } : {}),
    });
  }
  return outcome;
}

async function maybePublishRunResultAssets(sessionId, run, manifest, normalizedEvents) {
  if (manifest?.internalOperation) {
    return false;
  }

  let attachments = normalizePublishedResultAssetAttachments(run?.publishedResultAssets || []);
  if (attachments.length === 0) {
    const generatedFiles = await collectGeneratedResultFilesFromRun(run, manifest, normalizedEvents);
    if (generatedFiles.length === 0) {
      return false;
    }

    const publishedAssets = [];
    for (const file of generatedFiles) {
      try {
        const published = await publishLocalFileAssetFromPath({
          sessionId,
          localPath: file.localPath,
          originalName: file.originalName,
          mimeType: file.mimeType,
          createdBy: 'assistant',
        });
        publishedAssets.push({
          assetId: published.id,
          originalName: published.originalName || file.originalName,
          mimeType: published.mimeType || file.mimeType,
        });
      } catch (error) {
        console.error(`[result-file-assets] Failed to publish ${file.localPath}: ${error?.message || error}`);
      }
    }

    if (publishedAssets.length === 0) {
      return false;
    }

    const updatedRun = await updateRun(run.id, (current) => ({
      ...current,
      publishedResultAssets: Array.isArray(current.publishedResultAssets) && current.publishedResultAssets.length > 0
        ? current.publishedResultAssets
        : publishedAssets,
      publishedResultAssetsAt: current.publishedResultAssetsAt || nowIso(),
    })) || run;
    attachments = normalizePublishedResultAssetAttachments(updatedRun.publishedResultAssets || publishedAssets);
  }

  if (attachments.length === 0) {
    return false;
  }
  if (await findResultAssetMessageForRun(sessionId, run.id)) {
    return false;
  }

  await appendEvent(sessionId, messageEvent('assistant', buildResultAssetReadyMessage(attachments), attachments, {
    source: 'result_file_assets',
    resultRunId: run.id,
    ...(run.requestId ? { requestId: run.requestId } : {}),
  }));
  return true;
}

function hasPersistedResumeState(toolId, session) {
  const tool = typeof toolId === 'string' ? toolId.trim() : '';
  if (tool === 'claude') {
    return typeof session?.claudeSessionId === 'string' && session.claudeSessionId.trim().length > 0;
  }
  if (tool === 'codex') {
    return typeof session?.codexThreadId === 'string' && session.codexThreadId.trim().length > 0;
  }
  return false;
}

function isEarlyProviderStartupFailure(run, toolId) {
  if (!run || run.tool !== toolId) return false;
  if (run.state !== 'failed') return false;

  const normalizedEventCount = Number.isInteger(run.normalizedEventCount)
    ? run.normalizedEventCount
    : 0;
  const hasNoStructuredOutput = normalizedEventCount === 0;
  const neverStartedToolProcess = !Number.isInteger(run.toolProcessId);
  const neverStartedRun = !run.startedAt;
  if (!(hasNoStructuredOutput && neverStartedToolProcess && neverStartedRun)) {
    return false;
  }

  const failureReason = typeof run.failureReason === 'string' ? run.failureReason.trim() : '';
  if (!failureReason) return true;
  return /Provider exited without emitting structured events|Process exited with code 1/i.test(failureReason);
}

async function shouldResetProviderResumeState(toolId, session, activeRun, options = {}) {
  if (options.freshThread === true) return false;
  if (!hasPersistedResumeState(toolId, session)) return false;

  if (toolId === 'codex' && await shouldResetCodexResumeThread(session, options)) {
    return true;
  }

  return isEarlyProviderStartupFailure(activeRun, toolId);
}

async function shouldResetCodexResumeThread(session, options = {}) {
  if (options.freshThread === true) return false;
  const codexThreadId = typeof session?.codexThreadId === 'string' ? session.codexThreadId.trim() : '';
  if (!codexThreadId) return false;

  const metadata = await readCodexSessionMetadata(codexThreadId);
  const loggedCwd = typeof metadata?.cwd === 'string' ? metadata.cwd.trim() : '';
  if (!loggedCwd) return false;

  const expectedCwd = resolveCwd(typeof session?.folder === 'string' ? session.folder : '');
  const resumeCwd = resolveCwd(loggedCwd);
  if (!expectedCwd || !resumeCwd) return false;
  return expectedCwd !== resumeCwd;
}

function sanitizeAssistantRunEvents(events = []) {
  let latestTaskCard = null;
  let latestGraphOps = null;
  const sanitizedEvents = (Array.isArray(events) ? events : []).map((event) => {
    if (event?.type !== 'message' || event.role !== 'assistant') {
      return event;
    }

    const content = typeof event.content === 'string' ? event.content : '';
    const parsedTaskCard = parseTaskCardFromAssistantContent(content);
    const parsedGraphOps = parseGraphOpsFromAssistantContent(content);
    if (!parsedTaskCard && !parsedGraphOps) {
      return event;
    }

    const nextEvent = {
      ...event,
    };
    if (parsedTaskCard) {
      latestTaskCard = parsedTaskCard;
      nextEvent.taskCard = parsedTaskCard;
    }
    if (parsedGraphOps) {
      latestGraphOps = parsedGraphOps;
      nextEvent.graphOps = parsedGraphOps;
    }
    return nextEvent;
  });

  return { sanitizedEvents, latestTaskCard, latestGraphOps };
}

function normalizeAssistantGraphLookupKey(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function getAssistantGraphSessionTitleCandidates(session) {
  const candidates = [
    session?.name,
    session?.taskCard?.goal,
    session?.taskCard?.mainGoal,
    session?.sessionState?.goal,
    session?.sessionState?.mainGoal,
  ];
  const titles = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const normalized = normalizeAssistantGraphLookupKey(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    titles.push(normalized);
  }
  return titles;
}

function getAssistantGraphSessionDisplayTitle(session) {
  return String(
    session?.name
    || session?.taskCard?.goal
    || session?.taskCard?.mainGoal
    || session?.sessionState?.goal
    || session?.sessionState?.mainGoal
    || session?.id
    || '当前任务',
  ).trim();
}

function resolveAssistantGraphSessionRef(ref, {
  currentSessionId = '',
  rootSessionId = '',
  sessions = [],
} = {}) {
  const currentId = String(currentSessionId || '').trim();
  const rootId = String(rootSessionId || '').trim();
  const sessionId = String(
    ref && typeof ref === 'object' && !Array.isArray(ref)
      ? (ref.sessionId || ref.id || '')
      : '',
  ).trim();
  const rawRef = String(
    typeof ref === 'string'
      ? ref
      : (ref && typeof ref === 'object' && !Array.isArray(ref)
        ? (ref.ref || ref.title || ref.name || ref.goal || sessionId || '')
        : ''),
  ).trim();
  const lookupKey = normalizeAssistantGraphLookupKey(rawRef || sessionId);
  const allSessions = Array.isArray(sessions) ? sessions : [];
  const activeSessions = allSessions.filter((session) => session?.archived !== true);
  const searchPools = [activeSessions, allSessions];

  for (const pool of searchPools) {
    if (sessionId) {
      const bySessionId = pool.find((session) => String(session?.id || '').trim() === sessionId);
      if (bySessionId) return bySessionId;
    }
    if (rawRef) {
      const byLiteralId = pool.find((session) => String(session?.id || '').trim() === rawRef);
      if (byLiteralId) return byLiteralId;
    }
  }

  if (!lookupKey) return null;
  if (['current', 'self', 'this', '当前', '当前任务', '本任务'].includes(lookupKey)) {
    return allSessions.find((session) => String(session?.id || '').trim() === currentId) || null;
  }
  if (['main', 'root', '主线', '主任务', '根任务'].includes(lookupKey)) {
    return allSessions.find((session) => String(session?.id || '').trim() === rootId)
      || allSessions.find((session) => String(session?.rootSessionId || '').trim() === rootId && String(session?.id || '').trim() === rootId)
      || null;
  }

  for (const pool of searchPools) {
    const exactMatches = pool.filter((session) => getAssistantGraphSessionTitleCandidates(session).includes(lookupKey));
    if (exactMatches.length === 1) return exactMatches[0];
    if (exactMatches.length > 1) return null;
  }

  for (const pool of searchPools) {
    const partialMatches = pool.filter((session) => (
      getAssistantGraphSessionTitleCandidates(session).some((candidate) => candidate.includes(lookupKey) || lookupKey.includes(candidate))
    ));
    if (partialMatches.length === 1) return partialMatches[0];
    if (partialMatches.length > 1) return null;
  }

  return null;
}

export async function applySessionGraphOps(sessionId, graphOps = null) {
  const normalizedSessionId = String(sessionId || '').trim();
  const operations = Array.isArray(graphOps?.operations) ? graphOps.operations : [];
  if (!normalizedSessionId || operations.length === 0) {
    return {
      historyChanged: false,
      sessionChanged: false,
      appliedCount: 0,
    };
  }

  const { reparentSession } = await import('../workbench/branch-lifecycle.mjs');
  let rootSessionId = '';
  let scopedSessions = [];

  const refreshScopedSessions = async () => {
    const currentSession = await getSession(normalizedSessionId);
    if (!currentSession) {
      rootSessionId = normalizedSessionId;
      scopedSessions = [];
      return;
    }
    rootSessionId = String(currentSession.rootSessionId || currentSession.id || normalizedSessionId).trim();
    const allSessions = await listSessions({ includeArchived: true });
    scopedSessions = allSessions.filter((session) => {
      const candidateId = String(session?.id || '').trim();
      const candidateRootId = String(session?.rootSessionId || candidateId).trim();
      return candidateRootId === rootSessionId || candidateId === rootSessionId;
    });
  };

  await refreshScopedSessions();

  let historyChanged = false;
  let sessionChanged = false;
  let appliedCount = 0;

  for (const operation of operations) {
    const sourceSession = resolveAssistantGraphSessionRef(operation?.source, {
      currentSessionId: normalizedSessionId,
      rootSessionId,
      sessions: scopedSessions,
    });
    if (!sourceSession) {
      console.warn(`[assistant-graph-ops] source session not found in root ${rootSessionId || '(unknown)'}`);
      continue;
    }

    const currentParentSessionId = String(sourceSession?.sourceContext?.parentSessionId || '').trim();

    if (operation?.type === 'attach') {
      const targetSession = resolveAssistantGraphSessionRef(operation?.target, {
        currentSessionId: normalizedSessionId,
        rootSessionId,
        sessions: scopedSessions,
      });
      if (!targetSession || String(targetSession.id || '').trim() === String(sourceSession.id || '').trim()) {
        console.warn('[assistant-graph-ops] attach target missing or self-referential');
        continue;
      }
      if (String(targetSession.id || '').trim() === currentParentSessionId) {
        continue;
      }
      await reparentSession(sourceSession.id, {
        targetSessionId: targetSession.id,
        branchReason: operation.reason || `AI整理任务图：挂到「${getAssistantGraphSessionDisplayTitle(targetSession)}」下`,
      });
      historyChanged = true;
      sessionChanged = true;
      appliedCount += 1;
      await refreshScopedSessions();
      continue;
    }

    if (operation?.type === 'promote_main') {
      if (!currentParentSessionId) {
        continue;
      }
      await reparentSession(sourceSession.id, {
        targetSessionId: '',
        branchReason: operation.reason || 'AI整理任务图：移为主线',
      });
      historyChanged = true;
      sessionChanged = true;
      appliedCount += 1;
      await refreshScopedSessions();
      continue;
    }

    if (operation?.type === 'archive') {
      if (String(sourceSession.id || '').trim() === normalizedSessionId) {
        console.warn('[assistant-graph-ops] refusing to archive the current session during its own finalization');
        continue;
      }
      if (sourceSession.archived === true) {
        continue;
      }
      const targetSession = operation?.target
        ? resolveAssistantGraphSessionRef(operation.target, {
          currentSessionId: normalizedSessionId,
          rootSessionId,
          sessions: scopedSessions,
        })
        : null;
      const archiveLabel = targetSession
        ? `已归档重复任务：并入「${getAssistantGraphSessionDisplayTitle(targetSession)}」`
        : (operation.reason ? `已归档任务：${operation.reason}` : '已归档重复任务');
      await appendEvent(sourceSession.id, statusEvent(archiveLabel, {
        statusKind: 'assistant_graph_archived',
      }));
      await setSessionArchived(sourceSession.id, true);
      historyChanged = true;
      sessionChanged = true;
      appliedCount += 1;
      await refreshScopedSessions();
    }
  }

  return {
    historyChanged,
    sessionChanged,
    appliedCount,
  };
}

function normalizeCandidateBranchTitles(taskCard) {
  return Array.isArray(taskCard?.candidateBranches)
    ? taskCard.candidateBranches
      .map((entry) => String(entry || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    : [];
}

function getSessionParentSessionId(sessionMeta) {
  return typeof sessionMeta?.sourceContext?.parentSessionId === 'string'
    ? sessionMeta.sourceContext.parentSessionId.trim()
    : '';
}

function stabilizeSessionTaskCard(sessionMeta, taskCard, options = {}) {
  const managedBindingKeys = new Set(
    (Array.isArray(options?.managedBindingKeys) ? options.managedBindingKeys : [])
      .map((value) => trimString(value))
      .filter(Boolean),
  );
  const shouldPreserveManagedMainGoal = managedBindingKeys.has('mainGoal') || managedBindingKeys.has('goal');
  const shouldPreserveManagedCandidateBranches = managedBindingKeys.has('candidateBranches');
  const shouldPreserveManagedLineRole = managedBindingKeys.has('lineRole');
  const shouldPreserveManagedBranchFrom = managedBindingKeys.has('branchFrom');
  const shouldPreserveManagedBranchReason = managedBindingKeys.has('branchReason');
  const normalizeTaskCardOptions = shouldPreserveManagedCandidateBranches
    ? { preserveCandidateBranches: true }
    : undefined;
  const parsedTaskCard = normalizeSessionTaskCard(taskCard, normalizeTaskCardOptions);
  if (!parsedTaskCard) return null;

  const currentTaskCard = normalizeSessionTaskCard(sessionMeta?.taskCard || null);
  const stableSessionTitle = trimString(sessionMeta?.name);
  const canPersistBranchRole = Boolean(getSessionParentSessionId(sessionMeta));
  const explicitLineRole = taskCard && Object.prototype.hasOwnProperty.call(taskCard, 'lineRole');
  const resolvedLineRole = canPersistBranchRole && !explicitLineRole && currentTaskCard?.lineRole === 'branch'
    ? 'branch'
    : parsedTaskCard.lineRole;

  if (resolvedLineRole !== 'branch' || !canPersistBranchRole) {
    const anchoredMainGoal = trimString(
      shouldPreserveManagedMainGoal
        ? (parsedTaskCard.mainGoal || parsedTaskCard.goal || currentTaskCard?.mainGoal || currentTaskCard?.goal || stableSessionTitle)
        : (
          currentTaskCard?.lineRole !== 'branch'
            ? (currentTaskCard?.mainGoal || currentTaskCard?.goal || stableSessionTitle)
            : stableSessionTitle
        )
    ) || trimString(parsedTaskCard.mainGoal || parsedTaskCard.goal);

    return normalizeSessionTaskCard({
      ...parsedTaskCard,
      goal: anchoredMainGoal,
      mainGoal: anchoredMainGoal,
      lineRole: shouldPreserveManagedLineRole ? resolvedLineRole : 'main',
      branchFrom: shouldPreserveManagedBranchFrom
        ? (parsedTaskCard.branchFrom || currentTaskCard?.branchFrom || '')
        : '',
      branchReason: shouldPreserveManagedBranchReason
        ? (parsedTaskCard.branchReason || currentTaskCard?.branchReason || '')
        : '',
    }, normalizeTaskCardOptions);
  }

  const anchoredParentGoal = trimString(
    shouldPreserveManagedMainGoal
      ? (parsedTaskCard.mainGoal || currentTaskCard?.mainGoal || currentTaskCard?.goal || stableSessionTitle)
      : (
        parsedTaskCard.mainGoal
        || currentTaskCard?.mainGoal
        || currentTaskCard?.goal
        || stableSessionTitle
      ),
  ) || trimString(parsedTaskCard.branchFrom || parsedTaskCard.goal);

  return normalizeSessionTaskCard({
    ...parsedTaskCard,
    mainGoal: anchoredParentGoal,
    lineRole: shouldPreserveManagedLineRole ? resolvedLineRole : 'branch',
    branchFrom: shouldPreserveManagedBranchFrom
      ? (parsedTaskCard.branchFrom || currentTaskCard?.branchFrom || anchoredParentGoal)
      : trimString(parsedTaskCard.branchFrom || anchoredParentGoal),
    branchReason: shouldPreserveManagedBranchReason
      ? (parsedTaskCard.branchReason || currentTaskCard?.branchReason || '')
      : '',
  }, normalizeTaskCardOptions);
}

async function findLatestUserMessageSeqForRun(sessionId, run) {
  if (!sessionId || !run?.id) return 0;
  const events = await loadHistory(sessionId, { includeBodies: false });
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'message' || event.role !== 'user') continue;
    if (run.requestId && event.requestId === run.requestId) {
      return Number.isInteger(event.seq) ? event.seq : 0;
    }
    if (event.runId === run.id) {
      return Number.isInteger(event.seq) ? event.seq : 0;
    }
  }
  return 0;
}

function buildBranchCandidateStatusEvents(run, {
  sourceSeq = 0,
  previousTaskCard = null,
  nextTaskCard = null,
  suppressedBranchTitles = [],
} = {}) {
  const nextCandidates = normalizeCandidateBranchTitles(nextTaskCard);
  if (nextCandidates.length === 0) return [];

  const previousKeys = new Set(
    normalizeCandidateBranchTitles(previousTaskCard).map((entry) => entry.toLowerCase()),
  );
  const suppressedKeys = new Set(
    normalizeSuppressedBranchTitles(suppressedBranchTitles).map((entry) => entry.toLowerCase()),
  );
  const branchReason = trimString(nextTaskCard?.branchReason)
    || `当前主任务保持为「${trimString(nextTaskCard?.mainGoal || nextTaskCard?.goal) || '当前任务'}」，这条线建议单独展开。`;

  return nextCandidates
    .filter((branchTitle) => {
      const key = branchTitle.toLowerCase();
      return !previousKeys.has(key) && !suppressedKeys.has(key);
    })
    .map((branchTitle) => ({
      ...statusEvent(`建议拆出支线：${branchTitle}`, {
        statusKind: 'branch_candidate',
        branchTitle,
        branchReason,
        autoSuggested: true,
        intentShift: true,
        independentGoal: true,
        ...(sourceSeq > 0 ? { sourceSeq } : {}),
      }),
      runId: run.id,
      ...(run.requestId ? { requestId: run.requestId } : {}),
    }));
}

function normalizeRunEvents(run, events) {
  return (events || []).map((event) => ({
    ...event,
    runId: run.id,
    ...(run.requestId ? { requestId: run.requestId } : {}),
  }));
}

async function queueContextCompaction(sessionId, session, run, { automatic = false } = {}) {
  const live = ensureLiveSession(sessionId);
  if (live.pendingCompact) return false;

  const snapshot = await getHistorySnapshot(sessionId);
  const compactionSource = await buildCompactionSourcePayload(sessionId, session, {
    uptoSeq: snapshot.latestSeq,
  });
  if (!compactionSource) return false;

  const compactorSession = await ensureContextCompactorSession(sessionId, session, run);
  if (!compactorSession) return false;

  live.pendingCompact = true;

  const statusText = automatic
    ? getAutoCompactStatusText(run)
    : 'Auto Compress is condensing older context…';
  const compactQueuedEvent = statusEvent(statusText);
  await appendEvent(sessionId, compactQueuedEvent);
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
    const failure = statusEvent(`error: failed to compact context: ${error.message}`);
    await appendEvent(sessionId, failure);
    broadcastSessionInvalidation(sessionId);
    return false;
  }
}

async function maybeAutoCompact(sessionId, session, run, manifest) {
  if (!session || !run || manifest?.internalOperation) return false;
  if (getSessionQueueCount(session) > 0) return false;
  if (STARTUP_SYNC_DEBUG) {
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
    if (STARTUP_SYNC_DEBUG) {
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
  if (STARTUP_SYNC_DEBUG) {
    console.log('[auto-compact] thresholds', {
      contextTokens,
      autoCompactTokens,
      contextWindowTokens: metricsBackedRun.contextWindowTokens ?? null,
    });
  }
  if (!Number.isInteger(contextTokens) || !Number.isFinite(autoCompactTokens)) return false;
  if (contextTokens <= autoCompactTokens) return false;
  if (STARTUP_SYNC_DEBUG) {
    console.log('[auto-compact] queueing compaction', {
      sessionId,
      runId: run.id,
    });
  }
  return queueContextCompaction(sessionId, session, metricsBackedRun, { automatic: true });
}

async function applyCompactionWorkerResult(targetSessionId, run, manifest) {
  const workerEvent = await findLatestAssistantMessageForRun(run.sessionId, run.id);
  const parsed = parseCompactionWorkerOutput(workerEvent?.content || '');
  const summary = parsed.summary;
  if (!summary) {
    await appendEvent(targetSessionId, statusEvent('error: failed to apply auto compress: compaction worker returned no <summary> block'));
    return false;
  }

  const barrierEvent = await appendEvent(targetSessionId, createContextBarrierEvent(AUTO_COMPACT_MARKER_TEXT, {
    automatic: manifest?.compactionReason === 'automatic',
    compactionSessionId: run.sessionId,
  }));
  const handoffContent = parsed.handoff || buildFallbackCompactionHandoff(summary, manifest?.compactionToolIndex || '');
  const handoffEvent = await appendEvent(targetSessionId, messageEvent('assistant', handoffContent, undefined, {
    source: 'context_compaction_handoff',
    compactionRunId: run.id,
  }));
  const compactEvent = await appendEvent(targetSessionId, statusEvent('Auto Compress finished — continue from the handoff below'));

  await setContextHead(targetSessionId, {
    mode: 'summary',
    summary: '',
    toolIndex: manifest?.compactionToolIndex || '',
    activeFromSeq: compactEvent.seq,
    compactedThroughSeq: Number.isInteger(manifest?.compactionSourceSeq) ? manifest.compactionSourceSeq : compactEvent.seq,
    inputTokens: run.contextInputTokens || null,
    updatedAt: nowIso(),
    source: 'context_compaction',
    barrierSeq: barrierEvent.seq,
    handoffSeq: handoffEvent.seq,
    compactionSessionId: run.sessionId,
  });

  await clearPersistedResumeIds(targetSessionId);
  return true;
}

async function finalizeDetachedRun(sessionId, run, manifest, normalizedEvents = []) {
  return finalizeDetachedRunWithDeps({
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
  }, {
    sessionId,
    run,
    manifest,
    normalizedEvents,
  });
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

function ensureSessionManagerBuiltinHooksRegistered() {
  registerBuiltinHooks();
  registerSessionManagerBuiltinHooks({
    appendEvents,
    isSessionAutoRenamePending,
    loadHistory,
    listSessions,
    nowIso,
    triggerAutomaticSessionLabeling,
    resumePendingCompletionTargets,
    updateSessionTaskCard,
  });
}

const {
  observeDetachedRun,
  startDetachedRunObservers: startDetachedRunObserversViaObserverService,
  stopObservedRun,
} = createDetachedRunObserverService({
  ensureSessionManagerBuiltinHooksRegistered,
  flushQueuedFollowUps,
  getFollowUpQueueCount,
  getRun,
  isTerminalRunState,
  loadSessionsMeta,
  observedRunPollIntervalMs: OBSERVED_RUN_POLL_INTERVAL_MS,
  observedRuns,
  runDir,
  startupSyncDebug: STARTUP_SYNC_DEBUG,
  syncDetachedRun,
  trimString,
  watch,
});

const {
  sendMessage: sendMessageViaMessageSubmissionService,
  submitHttpMessage: submitHttpMessageViaMessageSubmissionService,
} = createSessionMessageSubmissionService({
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
  getLiveSession: (sessionId) => liveSessions.get(sessionId),
  getSession,
  hasRecentFollowUpRequestId,
  mutateSessionMeta,
  normalizeSourceContext,
  nowIso,
  observeDetachedRun,
  renameSession: renameSessionViaMetadataService,
  sanitizeQueuedFollowUpAttachments,
  sanitizeQueuedFollowUpOptions,
  scheduleQueuedFollowUpDispatch,
  shouldResetProviderResumeState,
  statusEvent,
  touchSessionMeta,
  updateSessionTool: updateSessionToolViaWorkflowRuntimeService,
});

export async function startDetachedRunObservers() {
  await startDetachedRunObserversViaObserverService();
  await emitHook('instance.resume', {
    sessionId: '',
    session: null,
    manifest: null,
    appendEvent,
    statusEvent,
  });
}

export async function listSessions({
  includeArchived = true,
  sourceId = '',
  includeQueuedMessages = false,
  taskListVisibility = 'all',
} = {}) {
  return listSessionsQuery({
    includeArchived,
    sourceId,
    includeQueuedMessages,
    taskListVisibility,
  });
}

export async function getSession(id, options = {}) {
  return getSessionQuery(id, options);
}

export async function getSessionEventsAfter(sessionId, afterSeq = 0, options = {}) {
  return getSessionEventsAfterQuery(sessionId, afterSeq, options);
}

export async function getSessionTimelineEvents(sessionId, options = {}) {
  return getSessionTimelineEventsQuery(sessionId, options);
}

export async function getSessionSourceContext(sessionId, options = {}) {
  return getSessionSourceContextQuery(sessionId, options);
}

export async function getRunState(runId) {
  const run = await getRun(runId);
  if (!run) return null;
  return await flushDetachedRunIfNeeded(run.sessionId, runId) || await getRun(runId);
}

export async function organizeSession(sessionId, options = {}) {
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  if (session.activity?.run?.state === 'running') {
    throw new Error('Session is currently running');
  }
  if (getSessionQueueCount(session) > 0) {
    throw new Error('Session has queued follow-up messages');
  }

  const prompt = await buildSessionOrganizerPrompt(session);
  const outcome = await sendMessage(sessionId, prompt, [], {
    tool: options.tool || session.tool,
    model: options.model || session.model || undefined,
    effort: options.effort || session.effort || undefined,
    thinking: options.thinking === true,
    recordUserMessage: false,
    queueIfBusy: false,
    internalOperation: SESSION_ORGANIZER_INTERNAL_OPERATION,
    freshThread: true,
    skipSessionContinuation: true,
  });

  return {
    run: outcome.run,
    session: outcome.session,
    duplicate: outcome.duplicate,
  };
}

export async function createSession(folder, tool, name, extra = {}) {
  return createSessionWithDeps({
    ensureSessionManagerBuiltinHooksRegistered,
    normalizeSourceContext,
    getNextSessionOrdinal,
    generateId,
    nowIso,
    enrichSessionMeta,
    broadcastSessionsInvalidation,
  }, canonicalizeSessionFolder(folder), tool, name, extra);
}

export async function setSessionArchived(id, archived = true) {
  return setSessionArchivedViaMetadataService(id, archived);
}

async function clearDeletedSessionRuntimeState(sessionIds = []) {
  for (const sessionId of Array.isArray(sessionIds) ? sessionIds : []) {
    clearRenameState(sessionId);
    liveSessions.delete(sessionId);
    await clearSessionHistory(sessionId);
    await clearContextHead(sessionId).catch(() => {});
    await clearForkContext(sessionId).catch(() => {});
  }
}

function broadcastPermanentSessionDeletion(rootSession, deletedSessionIds = []) {
  if (shouldExposeSession(rootSession)) {
    broadcastSessionsInvalidation();
  }
  for (const sessionId of Array.isArray(deletedSessionIds) ? deletedSessionIds : []) {
    broadcastSessionInvalidation(sessionId);
  }
}

export async function deleteSessionPermanently(id) {
  const current = await findSessionMeta(id);
  if (!current) return { deletedSessionIds: [] };
  assertSessionCanBeDeletedPermanently(current);

  const deletionPlan = await buildPermanentSessionDeletionPlan(id, current);
  if (!deletionPlan) {
    return { deletedSessionIds: [] };
  }

  await writePermanentSessionDeletionJournal(deletionPlan);

  const deletedSessionIds = await deleteSessionTreeMetadata(deletionPlan.targetIdSet);
  if (!deletedSessionIds.length) {
    return { deletedSessionIds: [] };
  }

  await clearDeletedSessionRuntimeState(deletedSessionIds);
  await deletePermanentSessionArtifacts(deletedSessionIds, {
    managedPaths: deletionPlan.deletionArtifacts.managedPaths,
    fileAssetIds: deletionPlan.deletionArtifacts.fileAssetIds,
    runFileAssetIds: deletionPlan.runFileAssetIds,
  }, {
    onDeleteRun: (runId) => {
      runSyncPromises.delete(runId);
      observedRuns.delete(runId);
    },
  });
  broadcastPermanentSessionDeletion(current, deletedSessionIds);

  return { deletedSessionIds };
}

export async function setSessionPinned(id, pinned = true) {
  return setSessionPinnedViaMetadataService(id, pinned);
}

export async function renameSession(id, name, options = {}) {
  return renameSessionViaMetadataService(id, name, options);
}

export async function updateSessionGrouping(id, patch = {}) {
  return updateSessionGroupingViaMetadataService(id, patch);
}

export async function updateSessionTaskCard(id, taskCard, options = {}) {
  return updateSessionTaskCardViaMetadataService(id, taskCard, options);
}

export async function updateSessionPersistent(id, persistent, options = {}) {
  return updateSessionPersistentViaPersistentService(id, persistent, options);
}

export async function promoteSessionToPersistent(id, payload = {}) {
  return promoteSessionToPersistentViaPersistentService(id, payload);
}

export async function runSessionPersistent(id, options = {}) {
  return runSessionPersistentViaPersistentService(id, options);
}

export async function setSessionBranchCandidateSuppressed(id, branchTitle, suppressed = true) {
  const normalizedTitle = String(branchTitle || '').replace(/\s+/g, ' ').trim();
  if (!normalizedTitle) return getSession(id);

  const result = await mutateSessionMeta(id, (session) => {
    const current = normalizeSuppressedBranchTitles(session.suppressedBranchTitles || []);
    const currentSet = new Set(current.map((entry) => entry.toLowerCase()));
    const key = normalizedTitle.toLowerCase();
    let next = current;

    if (suppressed) {
      if (currentSet.has(key)) return false;
      next = normalizeSuppressedBranchTitles([...current, normalizedTitle]);
    } else if (currentSet.has(key)) {
      next = current.filter((entry) => entry.toLowerCase() !== key);
    } else {
      return false;
    }

    if (next.length > 0) {
      session.suppressedBranchTitles = next;
    } else if (session.suppressedBranchTitles) {
      delete session.suppressedBranchTitles;
    }

    session.updatedAt = nowIso();
    return true;
  });

  if (!result.meta) return null;
  if (result.changed) {
    broadcastSessionInvalidation(id);
  }
  return enrichSessionMeta(result.meta);
}

export async function updateSessionAgreements(id, patch = {}) {
  const hasActiveAgreements = Object.prototype.hasOwnProperty.call(patch || {}, 'activeAgreements');
  if (!hasActiveAgreements) {
    return getSession(id);
  }
  return updateSessionAgreementsViaMetadataService(id, patch);
}

export async function updateSessionWorkflowState(id, workflowState) {
  return updateSessionWorkflowClassification(id, { workflowState });
}

export async function updateSessionWorkflowPriority(id, workflowPriority) {
  return updateSessionWorkflowClassification(id, { workflowPriority });
}

export async function updateSessionLastReviewedAt(id, lastReviewedAt) {
  return updateSessionLastReviewedAtViaMetadataService(id, lastReviewedAt);
}

export async function updateSessionWorkflowClassification(id, payload = {}) {
  return updateSessionWorkflowClassificationViaWorkflowRuntimeService(id, payload);
}

async function updateSessionTool(id, tool) {
  return updateSessionToolViaWorkflowRuntimeService(id, tool);
}

export async function updateSessionRuntimePreferences(id, patch = {}) {
  return updateSessionRuntimePreferencesViaWorkflowRuntimeService(id, patch);
}

export async function submitHttpMessage(sessionId, text, images, options = {}) {
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
  const hasPendingCompact = liveSessions.get(sessionId)?.pendingCompact === true;
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

export async function sendMessage(sessionId, text, images, options = {}) {
  ensureSessionManagerBuiltinHooksRegistered();
  return submitHttpMessage(sessionId, text, images, {
    ...options,
    requestId: options.requestId || createInternalRequestId('compat'),
  });
}

export async function cancelActiveRun(sessionId) {
  const session = await findSessionMeta(sessionId);
  if (!session?.activeRunId) return null;
  const run = await flushDetachedRunIfNeeded(sessionId, session.activeRunId) || await getRun(session.activeRunId);
  if (!run) return null;
  if (isTerminalRunState(run.state)) {
    return run;
  }
  const updated = await requestRunCancel(run.id);
  if (updated) {
    broadcastSessionInvalidation(sessionId);
  }
  return updated;
}

export async function getHistory(sessionId) {
  return getHistoryQuery(sessionId);
}

export async function forkSession(sessionId) {
  return forkSessionViaBranchingService(sessionId);
}

export async function delegateSession(sessionId, payload = {}) {
  return delegateSessionViaBranchingService(sessionId, payload);
}

export function killAll() {
  for (const sessionId of liveSessions.keys()) {
    clearFollowUpFlushTimer(sessionId);
  }
  liveSessions.clear();
  for (const runId of observedRuns.keys()) {
    stopObservedRun(runId);
  }
}
