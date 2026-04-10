import { randomBytes } from 'crypto';
import { watch } from 'fs';
import { dirname, join, resolve } from 'path';
import { resolveCwd } from '../process-runner.mjs';
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
  deriveRunFailureReasonFromResult,
  deriveRunStateFromResult,
  deriveStructuredRuntimeFailureReason,
  getAutoCompactContextTokens,
  getAutoCompactStatusText,
  getRunLiveContextTokens,
  hasTerminalRunResult,
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
import { createSessionCompactionService } from '../services/session/compaction-service.mjs';
import { createSessionWithDeps } from '../services/session/creation-service.mjs';
import { createDetachedRunObserverService } from '../services/session/detached-run-observer-service.mjs';
import { createDetachedRunSyncService } from '../services/session/detached-run-sync-service.mjs';
import {
  assertSessionCanBeDeletedPermanently,
  buildPermanentSessionDeletionPlan,
  deletePermanentSessionArtifacts,
  deleteSessionTreeMetadata,
  writePermanentSessionDeletionJournal,
} from '../services/session/deletion-service.mjs';
import { createSessionGraphOpsService } from '../services/session/graph-ops-service.mjs';
import { createSessionMetadataMutationService } from '../services/session/metadata-service.mjs';
import { createSessionMessageSubmissionService } from '../services/session/message-submission-service.mjs';
import { createSessionOrganizerService } from '../services/session/organizer-service.mjs';
import { createSessionPersistentService } from '../services/session/persistent-service.mjs';
import { buildPrompt, resolveResumeState } from '../services/session/prompt-service.mjs';
import { createSessionFollowUpQueueService } from '../services/session/follow-up-queue-service.mjs';
import { createResultAssetPublicationService } from '../services/session/result-asset-publication-service.mjs';
import { createSessionTaskCardService } from '../services/session/task-card-service.mjs';
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
  buildBranchCandidateStatusEvents,
  findLatestUserMessageSeqForRun,
  stabilizeSessionTaskCard,
} = createSessionTaskCardService({
  loadHistory,
  normalizeSessionTaskCard,
  normalizeSuppressedBranchTitles,
  statusEvent,
  trimString,
});
let detachedRunSyncService = null;
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
  syncDetachedRun: (...args) => detachedRunSyncService.syncDetachedRun(...args),
  collectNormalizedRunEvents: (...args) => detachedRunSyncService.collectNormalizedRunEvents(...args),
  dropActiveRunGeneratedHistoryEvents: (...args) => detachedRunSyncService.dropActiveRunGeneratedHistoryEvents(...args),
  withSyntheticSeqs: (...args) => detachedRunSyncService.withSyntheticSeqs(...args),
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

function createInternalRequestId(prefix = 'internal') {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}

const {
  clearFollowUpRuntimeState,
  flushQueuedFollowUps,
  scheduleQueuedFollowUpDispatch,
} = createSessionFollowUpQueueService({
  broadcastSessionInvalidation,
  buildQueuedFollowUpDispatchText,
  buildQueuedFollowUpSourceContext,
  buildQueuedFollowUpTranscriptText,
  createInternalRequestId,
  ensureLiveSession,
  findSessionMeta,
  flushDetachedRunIfNeeded,
  followUpFlushDelayMs: FOLLOW_UP_FLUSH_DELAY_MS,
  getFollowUpQueue,
  getRun,
  isTerminalRunState,
  mutateSessionMeta,
  nowIso,
  removeDispatchedQueuedFollowUps,
  resolveQueuedFollowUpDispatchOptions,
  sanitizeQueuedFollowUpAttachments,
  submitHttpMessage: (...args) => submitHttpMessage(...args),
  trimRecentFollowUpRequestIds,
});

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
  applySessionGraphOps: applySessionGraphOpsViaGraphOpsService,
} = createSessionGraphOpsService({
  appendEvent,
  getSession: (sessionId, options = {}) => getSession(sessionId, options),
  listSessions: (options = {}) => listSessions(options),
  setSessionArchived: setSessionArchivedViaMetadataService,
  statusEvent,
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
  finalizeSessionOrganizerRun,
  triggerAutomaticSessionLabeling,
} = createSessionOrganizerService({
  extractSessionOrganizerAssistantText,
  getSession,
  getSessionQueueCount,
  isSessionAutoRenamePending,
  parseSessionOrganizerResult,
  renameSession,
  triggerSessionLabelSuggestion,
  updateRun,
  updateSessionGrouping,
  updateSessionWorkflowClassification,
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

export async function applySessionGraphOps(sessionId, graphOps = null) {
  return applySessionGraphOpsViaGraphOpsService(sessionId, graphOps);
}

async function finalizeDetachedRun(sessionId, run, manifest, normalizedEvents = []) {
  return finalizeDetachedRunWithDeps({
    liveSessions,
    SESSION_ORGANIZER_INTERNAL_OPERATION,
    nowIso,
    sanitizeAssistantRunEvents,
    appendEvents,
    appendEvent,
    statusEvent,
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
    applyDirectCompactionResult,
    maybeAutoCompact,
    applyCompactionWorkerResult,
  }, {
    sessionId,
    run,
    manifest,
    normalizedEvents,
  });
}

let stopObservedRun = () => {};
detachedRunSyncService = createDetachedRunSyncService({
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
  startupSyncDebug: STARTUP_SYNC_DEBUG,
  stopObservedRun: (...args) => stopObservedRun(...args),
  structuredOutputSettleDelayMs: STRUCTURED_OUTPUT_SETTLE_DELAY_MS,
  synthesizeDetachedRunTermination,
  updateRun,
  writeRunResult,
});

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
  stopObservedRun: stopObservedRunViaObserverService,
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
  syncDetachedRun: (...args) => detachedRunSyncService.syncDetachedRun(...args),
  trimString,
  watch,
});
stopObservedRun = stopObservedRunViaObserverService;

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

const {
  applyCompactionWorkerResult,
  applyDirectCompactionResult,
  maybeAutoCompact,
} = createSessionCompactionService({
  appendEvent,
  autoCompactMarkerText: AUTO_COMPACT_MARKER_TEXT,
  broadcastSessionInvalidation,
  buildContextCompactionPrompt,
  buildFallbackCompactionHandoff,
  buildToolActivityIndex,
  clearPersistedResumeIds,
  contextCompactorSystemPrompt: CONTEXT_COMPACTOR_SYSTEM_PROMPT,
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
  internalSessionRoleContextCompactor: INTERNAL_SESSION_ROLE_CONTEXT_COMPACTOR,
  isContextCompactorSession,
  loadHistory,
  loadSessionsMeta,
  messageEvent,
  mutateSessionMeta,
  nowIso,
  parseCompactionWorkerOutput,
  prepareConversationOnlyContinuationBody,
  refreshCodexContextMetrics,
  sendMessage: sendMessageViaMessageSubmissionService,
  setContextHead,
  startupSyncDebug: STARTUP_SYNC_DEBUG,
  statusEvent,
});

const {
  maybePublishRunResultAssets,
} = createResultAssetPublicationService({
  appendEvent,
  buildResultAssetReadyMessage,
  collectGeneratedResultFilesFromRun,
  messageEvent,
  normalizePublishedResultAssetAttachments,
  nowIso,
  publishLocalFileAssetFromPath,
  updateRun,
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
    clearFollowUpRuntimeState(sessionId);
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
      detachedRunSyncService.clearTrackedRunSync(runId);
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
  return submitHttpMessageViaMessageSubmissionService(sessionId, text, images, options);
}

export async function sendMessage(sessionId, text, images, options = {}) {
  return sendMessageViaMessageSubmissionService(sessionId, text, images, options);
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
    clearFollowUpRuntimeState(sessionId);
  }
  liveSessions.clear();
  for (const runId of observedRuns.keys()) {
    stopObservedRun(runId);
  }
}
