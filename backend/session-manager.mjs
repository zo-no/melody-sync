import { randomBytes } from 'crypto';
import { watch } from 'fs';
import { writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { CHAT_FILE_ASSET_CACHE_DIR, CHAT_IMAGES_DIR } from '../lib/config.mjs';
import { getToolDefinitionAsync } from '../lib/tools.mjs';
import { createToolInvocation, resolveCwd } from './process-runner.mjs';
import {
  appendEvent,
  appendEvents,
  clearSessionHistory,
  clearContextHead,
  clearForkContext,
  getContextHead,
  getForkContext,
  getHistorySnapshot,
  loadHistory,
  readEventsAfter,
  setForkContext,
  setContextHead,
} from './history.mjs';
import { messageEvent, statusEvent } from './normalizer.mjs';
import { buildSourceRuntimePrompt } from './source-runtime-prompts.mjs';
import { emit as emitHook } from './hooks/runtime/registry.mjs';
import { registerBuiltinHooks } from './hooks/runtime/register-builtins.mjs';
import { createFollowUpQueueHelpers } from './follow-up-queue.mjs';
import {
  buildSessionFolderUnavailableMessage,
  canonicalizeSessionFolder,
  inspectSessionFolder,
} from './session-folder.mjs';
import {
  buildSessionOrganizerPrompt,
  extractSessionOrganizerAssistantText,
  parseSessionOrganizerResult,
  SESSION_ORGANIZER_INTERNAL_OPERATION,
} from './session-organizer.mjs';
import { triggerSessionLabelSuggestion } from './summarizer.mjs';
import { buildSystemContext } from './system-prompt.mjs';
import { normalizeSessionAgreements } from './session-agreements.mjs';
import {
  buildSessionContinuationContextFromBody,
  prepareSessionContinuationBody,
} from './session-continuation.mjs';
import { broadcastOwners, getClientsMatching } from './ws-clients.mjs';
import {
  buildTemporarySessionName,
  isSessionAutoRenamePending,
  normalizeSessionDescription,
  normalizeSessionGroup,
  resolveInitialSessionName,
} from './session-naming.mjs';
import {
  didSessionWorkflowTransitionToDone,
  normalizeSessionWorkflowPriority,
  normalizeSessionWorkflowState,
  SESSION_WORKFLOW_STATE_WAITING_USER,
} from './session-workflow-state.mjs';
import {
  formatAttachmentContextLine,
  stripEventAttachmentSavedPaths,
} from './attachment-utils.mjs';
import {
  buildContextCompactionPrompt,
  buildFallbackCompactionHandoff,
  buildToolActivityIndex,
  clipCompactionSection,
  parseCompactionWorkerOutput,
  prepareConversationOnlyContinuationBody,
} from './session-compaction.mjs';
import {
  buildPreparedContinuationContext,
  isPreparedForkContextCurrent,
} from './session-fork-context.mjs';
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
} from './runs.mjs';
import { readCodexSessionMetadata, readLatestCodexSessionMetrics } from './codex-session-metrics.mjs';
import { spawnDetachedRunner } from './runner-supervisor.mjs';
import {
  buildSessionActivity,
  getSessionQueueCount,
  getSessionRunId,
  isSessionRunning,
  resolveSessionRunActivity,
} from './session-activity.mjs';
import {
  findSessionMeta,
  findSessionMetaCached,
  loadSessionsMeta,
  mutateSessionMeta,
  withSessionsMetaMutation,
} from './session-meta-store.mjs';
import { dispatchSessionEmailCompletionTargets, sanitizeEmailCompletionTargets } from '../lib/agent-mail-completion-targets.mjs';
import {
  applySessionCompatFields,
  normalizeAppId,
  normalizeSessionCompatInput,
  normalizeSessionSourceName,
  normalizeSessionUserName,
  resolveSessionSourceId,
  resolveSessionSourceName,
} from './session-source/meta-fields.mjs';
import { deleteFileAssets, publishLocalFileAssetFromPath } from './file-assets.mjs';
import { ensureDir, pathExists, removePath, statOrNull } from './fs-utils.mjs';
import {
  buildResultAssetReadyMessage,
  collectGeneratedResultFilesFromRun,
  normalizePublishedResultAssetAttachments,
  resolveAttachmentExtension,
  resolveAttachmentMimeType,
  sanitizeOriginalAttachmentName,
} from './result-assets.mjs';
import {
  buildTaskCardPromptBlock,
  normalizeSessionTaskCard,
  parseTaskCardFromAssistantContent,
  projectTaskCardFromSessionState,
  stripTaskCardFromAssistantContent,
} from './session-task-card.mjs';
import { resolveSessionStateFromSession } from './session-state.mjs';
import {
  buildNormalizedRunResultEnvelope,
  mergeRunResultWithEnvelope,
  runResultEnvelopeHasMeaningfulContent,
} from './run-result-envelope.mjs';
import { writeSessionDeletionJournalEntry } from './session-deletion-journal.mjs';
import {
  buildPersistentDigest,
  buildPersistentRunMessage,
  computeNextRecurringRunAt,
  normalizeSessionPersistent,
  resolvePersistentRunRuntime,
} from './session-persistent.mjs';
import { finalizeDetachedRunWithDeps } from './run-finalization.mjs';
import { registerSessionManagerBuiltinHooks } from './hooks/runtime/register-session-manager-hooks.mjs';
import { appendGraphBootstrapPromptContext } from './workbench/graph-prompt-context.mjs';
import { syncSessionContinuityFromSession } from './workbench/index.mjs';
import { workbenchQueue } from './workbench/queues.mjs';
import { loadWorkbenchState, saveWorkbenchState } from './workbench/state-store.mjs';

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

const DEFAULT_AUTO_COMPACT_CONTEXT_WINDOW_PERCENT = 100;
const FOLLOW_UP_FLUSH_DELAY_MS = 1500;
const MAX_RECENT_FOLLOW_UP_REQUEST_IDS = 100;
const OBSERVED_RUN_POLL_INTERVAL_MS = 250;
const RESULT_FILE_MAX_ATTACHMENTS = 4;
const RESULT_FILE_COMMAND_OUTPUT_FLAGS = new Set(['-o', '--output', '--out', '--export']);
const STARTUP_SYNC_DEBUG = process.env.MELODYSYNC_STARTUP_SYNC_DEBUG === '1';
const {
  getFollowUpQueue,
  getFollowUpQueueCount,
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
  sanitizeQueuedFollowUpAttachments,
  formatAttachmentContextLine,
  maxRecentFollowUpRequestIds: MAX_RECENT_FOLLOW_UP_REQUEST_IDS,
});

function parsePositiveIntOrInfinity(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  if (/^(inf|infinity)$/i.test(trimmed)) return Number.POSITIVE_INFINITY;
  const parsed = parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeSessionSidebarOrder(value) {
  const parsed = typeof value === 'number'
    ? value
    : parseInt(String(value || '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
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

function normalizeSessionTaskCardManagedBindings(value) {
  const source = Array.isArray(value) ? value : [];
  const allowed = new Set([
    'mainGoal',
    'goal',
    'summary',
    'candidateBranches',
    'checkpoint',
    'nextSteps',
    'lineRole',
    'branchFrom',
    'branchReason',
    'memory',
    'knownConclusions',
  ]);
  const normalized = [];
  const seen = new Set();
  for (const entry of source) {
    const key = trimString(entry);
    if (!key || !allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

function getConfiguredAutoCompactContextTokens() {
  return parsePositiveIntOrInfinity(process.env.MELODYSYNC_LIVE_CONTEXT_COMPACT_TOKENS);
}

function getRunLiveContextTokens(run) {
  return Number.isInteger(run?.contextInputTokens) && run.contextInputTokens > 0
    ? run.contextInputTokens
    : null;
}

function getRunContextWindowTokens(run) {
  return Number.isInteger(run?.contextWindowTokens) && run.contextWindowTokens > 0
    ? run.contextWindowTokens
    : null;
}

function getAutoCompactContextTokens(run) {
  const configured = getConfiguredAutoCompactContextTokens();
  if (configured !== null) {
    return configured;
  }
  const contextWindowTokens = getRunContextWindowTokens(run);
  if (!Number.isInteger(contextWindowTokens)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(
    1,
    Math.floor((contextWindowTokens * DEFAULT_AUTO_COMPACT_CONTEXT_WINDOW_PERCENT) / 100),
  );
}

async function refreshCodexContextMetrics(run) {
  if (!run?.id || !run?.codexThreadId) return null;
  const metrics = await readLatestCodexSessionMetrics(run.codexThreadId);
  if (!Number.isInteger(metrics?.contextTokens)) return null;

  await updateRun(run.id, (current) => ({
    ...current,
    contextInputTokens: metrics.contextTokens,
    ...(Number.isInteger(metrics.contextWindowTokens)
      ? { contextWindowTokens: metrics.contextWindowTokens }
      : {}),
  }));

  return metrics;
}

function getAutoCompactStatusText(run) {
  const configured = getConfiguredAutoCompactContextTokens();
  const contextTokens = getRunLiveContextTokens(run);
  const contextWindowTokens = getRunContextWindowTokens(run);
  if (configured === null && Number.isInteger(contextTokens) && Number.isInteger(contextWindowTokens)) {
    const percent = ((contextTokens / contextWindowTokens) * 100).toFixed(1);
    return `Live context exceeded the model window (${contextTokens.toLocaleString()} / ${contextWindowTokens.toLocaleString()}, ${percent}%) — compacting conversation…`;
  }
  const autoCompactTokens = getAutoCompactContextTokens(run);
  if (Number.isFinite(autoCompactTokens)) {
    return `Live context exceeded ${autoCompactTokens.toLocaleString()} tokens — compacting conversation…`;
  }
  return 'Live context overflowed — compacting conversation…';
}

const liveSessions = new Map();
const observedRuns = new Map();
const runSyncPromises = new Map();
const MAX_SESSION_SOURCE_CONTEXT_BYTES = 16 * 1024;

function nowIso() {
  return new Date().toISOString();
}

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

function isRecordedProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    return true;
  }
}

async function synthesizeDetachedRunTermination(runId, run) {
  const hasRecordedProcess = Number.isInteger(run?.runnerProcessId) || Number.isInteger(run?.toolProcessId);
  if (!hasRecordedProcess || isTerminalRunState(run?.state)) {
    return null;
  }
  const runnerAlive = isRecordedProcessAlive(run?.runnerProcessId);
  const toolAlive = isRecordedProcessAlive(run?.toolProcessId);
  if (runnerAlive || toolAlive) {
    return null;
  }

  const completedAt = nowIso();
  const cancelled = run?.cancelRequested === true;
  const runOutputPreview = await collectRunOutputPreview(runId);
  const error = cancelled
    ? null
    : await deriveStructuredRuntimeFailureReason(runId, runOutputPreview);
  const result = {
    completedAt,
    exitCode: 1,
    signal: null,
    cancelled,
    ...(error ? { error } : {}),
  };

  await writeRunResult(runId, result);
  return await updateRun(runId, (current) => ({
    ...current,
    state: cancelled ? 'cancelled' : 'failed',
    completedAt,
    result,
    failureReason: error,
  })) || run;
}

function deriveRunStateFromResult(run, result) {
  if (!result || typeof result !== 'object') return null;
  if (result.cancelled === true) {
    return 'cancelled';
  }
  if ((result.exitCode ?? 1) === 0 && !result.error) {
    return 'completed';
  }
  if (run?.cancelRequested === true && (((result.exitCode ?? 1) !== 0) || result.signal)) {
    return 'cancelled';
  }
  return 'failed';
}

function deriveRunFailureReasonFromResult(run, result) {
  if (!result || typeof result !== 'object') {
    return run?.failureReason || null;
  }
  if (typeof result.error === 'string' && result.error.trim()) {
    return result.error.trim();
  }
  if (typeof run?.failureReason === 'string' && run.failureReason.trim()) {
    return run.failureReason.trim();
  }
  if (result.cancelled === true) {
    return null;
  }
  if (typeof result.signal === 'string' && result.signal) {
    return `Process exited via signal ${result.signal}`;
  }
  if (Number.isInteger(result.exitCode)) {
    return `Process exited with code ${result.exitCode}`;
  }
  return run?.failureReason || null;
}

function clipFailurePreview(text, maxChars = 280) {
  if (typeof text !== 'string') return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(1, maxChars - 3)).trimEnd()}...`;
}

async function collectRunOutputPreview(runId, maxLines = 3) {
  const records = await readRunSpoolRecords(runId);
  if (!Array.isArray(records) || records.length === 0) return '';

  const lines = [];
  for (const record of records) {
    if (!record || !['stdout', 'stderr', 'error'].includes(record.stream)) continue;
    const line = clipFailurePreview(await materializeRunSpoolLine(runId, record));
    if (!line) continue;
    lines.push(line);
  }

  return lines.slice(-maxLines).join(' | ');
}

async function deriveStructuredRuntimeFailureReason(runId, previewText = '') {
  const preview = clipFailurePreview(previewText) || await collectRunOutputPreview(runId);
  if (!preview) {
    const manifest = await getRunManifest(runId);
    const folderState = inspectSessionFolder(manifest?.folder || '', {
      allowPersistentFallback: false,
    });
    if (!folderState.available) {
      return buildSessionFolderUnavailableMessage(manifest?.folder || '');
    }
  }
  if (preview && /(请登录|登录超时|auth|authentication|sso|sign in|login)/i.test(preview)) {
    return `Provider requires interactive login before MelodySync can use it: ${preview}`;
  }
  if (preview && /Detached runner disappeared before writing a result/i.test(preview)) {
    return `Provider terminated before persisting result: ${preview}`;
  }
  if (preview && /connection (closed|reset|terminated|was forcibly closed)|socket hang up|EPIPE|ECONNRESET/i.test(preview)) {
    return `Provider transport disrupted before result completion: ${preview}`;
  }
  if (preview && /api_retry/i.test(preview)) {
    return `Provider is retrying API calls without returning assistant output: ${preview}`;
  }
  if (preview) {
    return `Provider exited without emitting structured events: ${preview}`;
  }
  return 'Provider exited without emitting structured events';
}

function generateId() {
  return randomBytes(16).toString('hex');
}

function buildForkSessionName(session) {
  const sourceName = typeof session?.name === 'string' ? session.name.trim() : '';
  return `fork - ${sourceName || 'session'}`;
}

function buildDelegatedSessionName(session, task) {
  const taskLabel = buildTemporarySessionName(task, 48);
  if (taskLabel) {
    return `delegate - ${taskLabel}`;
  }
  const sourceName = typeof session?.name === 'string' ? session.name.trim() : '';
  return `delegate - ${sourceName || 'session'}`;
}

function buildSessionNavigationHref(sessionId) {
  const normalized = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!normalized) return '/?tab=sessions';
  return `/?session=${encodeURIComponent(normalized)}&tab=sessions`;
}

function buildDelegationNoticeMessage(task, childSession) {
  const normalizedTask = clipCompactionSection(task, 240)
    .replace(/\s+/g, ' ')
    .trim();
  const childName = typeof childSession?.name === 'string'
    ? childSession.name.trim()
    : 'new session';
  const childId = typeof childSession?.id === 'string' ? childSession.id.trim() : '';
  const link = childId ? `[${childName}](${buildSessionNavigationHref(childId)})` : childName;
  return [
    'Spawned a parallel session for this work.',
    '',
    normalizedTask ? `- Task: ${normalizedTask}` : '',
    `- Session: ${link}`,
    '',
    'This new session is independent and can continue on its own.',
  ].filter(Boolean).join('\n');
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

function sanitizeQueuedFollowUpAttachments(images) {
  return (images || [])
    .map((image) => {
      const filename = typeof image?.filename === 'string' ? image.filename.trim() : '';
      const savedPath = typeof image?.savedPath === 'string' ? image.savedPath.trim() : '';
      const assetId = typeof image?.assetId === 'string' ? image.assetId.trim() : '';
      const originalName = sanitizeOriginalAttachmentName(image?.originalName || '');
      const mimeType = resolveAttachmentMimeType(image?.mimeType, originalName || filename);
      if (!savedPath && !assetId) return null;
      return {
        ...(filename ? { filename } : {}),
        ...(savedPath ? { savedPath } : {}),
        ...(assetId ? { assetId } : {}),
        ...(originalName ? { originalName } : {}),
        mimeType,
      };
    })
    .filter(Boolean);
}

function sanitizeQueuedFollowUpOptions(options = {}) {
  const next = {};
  if (typeof options.tool === 'string' && options.tool.trim()) next.tool = options.tool.trim();
  if (typeof options.model === 'string' && options.model.trim()) next.model = options.model.trim();
  if (typeof options.effort === 'string' && options.effort.trim()) next.effort = options.effort.trim();
  if (options.thinking === true) next.thinking = true;
  const sourceContext = normalizeSourceContext(options.sourceContext);
  if (sourceContext) next.sourceContext = sourceContext;
  return next;
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

function sanitizeForkedEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const next = JSON.parse(JSON.stringify(event));
  delete next.seq;
  delete next.runId;
  delete next.requestId;
  delete next.bodyRef;
  delete next.bodyField;
  delete next.bodyAvailable;
  delete next.bodyLoaded;
  delete next.bodyBytes;
  delete next.bodyPersistence;
  delete next.bodyTruncated;
  delete next.bodyPreview;
  return next;
}

function createInternalRequestId(prefix = 'internal') {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}

function getInternalSessionRole(meta) {
  return typeof meta?.internalRole === 'string' ? meta.internalRole.trim() : '';
}

function isInternalSession(meta) {
  return !!getInternalSessionRole(meta);
}

function isContextCompactorSession(meta) {
  return getInternalSessionRole(meta) === INTERNAL_SESSION_ROLE_CONTEXT_COMPACTOR;
}

function shouldExposeSession(meta) {
  return !isInternalSession(meta);
}

function ensureLiveSession(sessionId) {
  let live = liveSessions.get(sessionId);
  if (!live) {
    live = {};
    liveSessions.set(sessionId, live);
  }
  return live;
}

function stopObservedRun(runId) {
  const observed = observedRuns.get(runId);
  if (!observed) return;
  if (observed.timer) {
    clearTimeout(observed.timer);
  }
  if (observed.poller) {
    clearInterval(observed.poller);
  }
  try {
    observed.watcher?.close();
  } catch {}
  observedRuns.delete(runId);
}

function scheduleObservedRunSync(runId, delayMs = 40) {
  const observed = observedRuns.get(runId);
  if (!observed) return;
  if (observed.timer) {
    clearTimeout(observed.timer);
  }
  observed.timer = setTimeout(() => {
    const current = observedRuns.get(runId);
    if (!current) return;
    current.timer = null;
    void (async () => {
      try {
        const run = await syncDetachedRun(current.sessionId, runId);
        if (!run || isTerminalRunState(run.state)) {
          stopObservedRun(runId);
        }
      } catch (error) {
        console.error(`[runs] observer sync failed for ${runId}: ${error.message}`);
      }
    })();
  }, delayMs);
  if (typeof observed.timer.unref === 'function') {
    observed.timer.unref();
  }
}

function observeDetachedRun(sessionId, runId, { initialSync = true } = {}) {
  if (!runId) return false;
  const existing = observedRuns.get(runId);
  if (existing) {
    existing.sessionId = sessionId;
    return true;
  }
  try {
    const watcher = watch(runDir(runId), (_eventType, filename) => {
      if (filename) {
        const changed = String(filename);
        if (!['spool.jsonl', 'status.json', 'result.json'].includes(changed)) {
          return;
        }
      }
      scheduleObservedRunSync(runId);
    });
    watcher.on('error', (error) => {
      console.error(`[runs] observer error for ${runId}: ${error.message}`);
      stopObservedRun(runId);
    });
    const poller = setInterval(() => {
      scheduleObservedRunSync(runId, 0);
    }, OBSERVED_RUN_POLL_INTERVAL_MS);
    if (typeof poller.unref === 'function') {
      poller.unref();
    }
    observedRuns.set(runId, { sessionId, watcher, timer: null, poller });
    if (initialSync) {
      scheduleObservedRunSync(runId, 0);
    }
    return true;
  } catch (error) {
    console.error(`[runs] failed to observe ${runId}: ${error.message}`);
    return false;
  }
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

async function buildSessionTimelineEvents(sessionId, options = {}) {
  const includeBodies = options.includeBodies !== false;
  const history = await loadHistory(sessionId, { includeBodies });
  const sessionMeta = options.sessionMeta || await findSessionMeta(sessionId);
  const activeRunId = typeof sessionMeta?.activeRunId === 'string' ? sessionMeta.activeRunId.trim() : '';
  if (!activeRunId) {
    return history;
  }

  const run = await getRun(activeRunId);
  if (!run || run.finalizedAt) {
    return history;
  }

  const manifest = await getRunManifest(activeRunId);
  if (!manifest) {
    return history;
  }
  if (manifest.internalOperation === SESSION_ORGANIZER_INTERNAL_OPERATION) {
    return history;
  }

  const projected = await collectNormalizedRunEvents(run, manifest);
  if (projected.normalizedEvents.length === 0) {
    return dropActiveRunGeneratedHistoryEvents(history, activeRunId);
  }

  const committedLatestSeq = history.reduce(
    (maxSeq, event) => (Number.isInteger(event?.seq) && event.seq > maxSeq ? event.seq : maxSeq),
    0,
  );

  return [
    ...dropActiveRunGeneratedHistoryEvents(history, activeRunId),
    ...withSyntheticSeqs(projected.normalizedEvents, committedLatestSeq),
  ];
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
    stopObservedRun(runId);
  }
  return run;
}

export async function resolveSavedAttachments(images) {
  const resolved = await Promise.all((images || []).map(async (image) => {
    const filename = typeof image?.filename === 'string' ? image.filename.trim() : '';
    if (!filename || !/^[a-zA-Z0-9_-]+\.[a-z0-9]+$/.test(filename)) return null;
    const savedPath = join(CHAT_IMAGES_DIR, filename);
    if (!await pathExists(savedPath)) return null;
    const originalName = sanitizeOriginalAttachmentName(image?.originalName || '');
    const mimeType = resolveAttachmentMimeType(image?.mimeType, originalName || filename);
    return {
      filename,
      savedPath,
      ...(originalName ? { originalName } : {}),
      mimeType,
    };
  }));
  return resolved.filter(Boolean);
}

export async function saveAttachments(images) {
  if (!images || images.length === 0) return [];
  await ensureDir(CHAT_IMAGES_DIR);
  return Promise.all(images.map(async (img) => {
    const originalName = sanitizeOriginalAttachmentName(img?.originalName || img?.name || '');
    const mimeType = resolveAttachmentMimeType(img?.mimeType, originalName);
    const ext = resolveAttachmentExtension(mimeType, originalName);
    const filename = randomBytes(12).toString('hex') + ext;
    const filepath = join(CHAT_IMAGES_DIR, filename);
    const fileBuffer = Buffer.isBuffer(img?.buffer)
      ? img.buffer
      : Buffer.from(typeof img?.data === 'string' ? img.data : '', 'base64');
    await writeFile(filepath, fileBuffer);
    return {
      filename,
      savedPath: filepath,
      ...(originalName ? { originalName } : {}),
      mimeType,
      ...(typeof img?.data === 'string' ? { data: img.data } : {}),
    };
  }));
}

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

function getSessionSortTime(meta) {
  const stamp = meta?.updatedAt || meta?.created || '';
  const time = new Date(stamp).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getSessionPinSortRank(meta) {
  return meta?.pinned === true ? 1 : 0;
}

function normalizeSessionReviewedAt(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  const time = Date.parse(trimmed);
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

async function enrichSessionMeta(meta, _options = {}) {
  const live = liveSessions.get(meta.id);
  const snapshot = await getHistorySnapshot(meta.id);
  const queuedCount = getFollowUpQueueCount(meta);
  const runActivity = await resolveSessionRunActivity(meta);
  const taskCard = stabilizeSessionTaskCard(meta, meta.taskCard, {
    managedBindingKeys: meta?.taskCardManagedBindings,
  });
  const {
    followUpQueue,
    recentFollowUpRequestIds,
    activeRunId,
    activeRun,
    sourceId: _rawSourceId,
    sourceName: _rawSourceName,
    visitorId: _legacyVisitorId,
    visitorName: _legacyVisitorName,
    taskCard: _rawTaskCard,
    taskCardManagedBindings: _taskCardManagedBindings,
    ...rest
  } = meta;
  const sourceId = resolveSessionSourceId(meta);
  return {
    ...rest,
    ...(taskCard ? { taskCard } : {}),
    sourceId,
    sourceName: resolveSessionSourceName(meta, sourceId),
    latestSeq: snapshot.latestSeq,
    lastEventAt: snapshot.lastEventAt,
    messageCount: snapshot.messageCount,
    activeMessageCount: snapshot.activeMessageCount,
    contextMode: snapshot.contextMode,
    activeFromSeq: snapshot.activeFromSeq,
    compactedThroughSeq: snapshot.compactedThroughSeq,
    contextTokenEstimate: snapshot.contextTokenEstimate,
    activity: buildSessionActivity(meta, live, {
      runState: runActivity.state,
      run: runActivity.run,
      queuedCount,
    }),
  };
}

async function enrichSessionMetaForClient(meta, options = {}) {
  if (!meta) return null;
  const session = await enrichSessionMeta(meta, options);
  if (options.includeQueuedMessages) {
    session.queuedMessages = getFollowUpQueue(meta).map(serializeQueuedFollowUp);
  }
  return session;
}

async function flushDetachedRunIfNeeded(sessionId, runId) {
  if (!sessionId || !runId) return null;
  const run = await getRun(runId);
  if (!run) return null;
  if (!run.finalizedAt || !isTerminalRunState(run.state)) {
    return await syncDetachedRun(sessionId, runId) || await getRun(runId);
  }
  return run;
}

async function reconcileLinkedCompactionSession(meta) {
  const compactionSessionId = typeof meta?.compactionSessionId === 'string'
    ? meta.compactionSessionId.trim()
    : '';
  if (!compactionSessionId) return false;
  const compactionMeta = await findSessionMeta(compactionSessionId);
  if (!compactionMeta?.activeRunId) return false;
  await syncDetachedRun(compactionMeta.id, compactionMeta.activeRunId);
  return true;
}

async function reconcileSessionMeta(meta) {
  let changed = false;
  if (meta?.activeRunId) {
    await syncDetachedRun(meta.id, meta.activeRunId);
    changed = true;
  }
  if (await reconcileLinkedCompactionSession(meta)) {
    changed = true;
  }
  return changed ? (await findSessionMeta(meta.id) || meta) : meta;
}

async function reconcileSessionsMetaList(list) {
  let changed = false;
  for (const meta of list) {
    if (meta?.activeRunId) {
      await syncDetachedRun(meta.id, meta.activeRunId);
      changed = true;
    }
    if (await reconcileLinkedCompactionSession(meta)) {
      changed = true;
    }
  }
  return changed ? loadSessionsMeta() : list;
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

function sendToClients(clients, msg) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    try {
      client.send(data);
    } catch {}
  }
}

export function broadcastSessionsInvalidation() {
  broadcastOwners({ type: 'sessions_invalidated' });
}

export function broadcastSessionInvalidation(sessionId) {
  const session = findSessionMetaCached(sessionId);
  const clients = getClientsMatching((client) => {
    const authSession = client._authSession;
    if (!authSession) return false;
    return authSession.role === 'owner' && shouldExposeSession(session);
  });
  sendToClients(clients, { type: 'session_invalidated', sessionId });
}

async function prepareForkContextSnapshot(sessionId, snapshot, contextHead) {
  const summary = typeof contextHead?.summary === 'string' ? contextHead.summary.trim() : '';
  const activeFromSeq = Number.isInteger(contextHead?.activeFromSeq) ? contextHead.activeFromSeq : 0;
  const handoffSeq = Number.isInteger(contextHead?.handoffSeq) ? contextHead.handoffSeq : 0;
  const preparedThroughSeq = snapshot?.latestSeq || 0;

  if (summary) {
    const [recentEvents, handoffHistory] = await Promise.all([
      preparedThroughSeq > activeFromSeq
        ? loadHistory(sessionId, {
            fromSeq: Math.max(1, activeFromSeq + 1),
            includeBodies: true,
          })
        : [],
      handoffSeq > 0
        ? loadHistory(sessionId, {
            fromSeq: handoffSeq,
            includeBodies: true,
          })
        : [],
    ]);
    const handoffEvent = handoffSeq > 0
      ? handoffHistory.find((event) => (event?.seq || 0) === handoffSeq && event?.type === 'message')
      : null;
    const continuationEvents = handoffEvent
      ? [handoffEvent, ...recentEvents]
      : recentEvents;
    const continuationBody = prepareSessionContinuationBody(continuationEvents);
    return {
      mode: 'summary',
      summary,
      continuationBody,
      activeFromSeq,
      handoffSeq,
      includesCompactionHandoff: Boolean(handoffEvent),
      preparedThroughSeq,
      contextUpdatedAt: contextHead?.updatedAt || null,
      updatedAt: nowIso(),
      source: contextHead?.source || 'context_head',
    };
  }

  if (preparedThroughSeq <= 0) {
    return null;
  }

  const priorHistory = await loadHistory(sessionId, { includeBodies: true });
  const continuationBody = prepareSessionContinuationBody(priorHistory);
  if (!continuationBody) {
    return null;
  }

  return {
    mode: 'history',
    summary: '',
    continuationBody,
    activeFromSeq: 0,
    handoffSeq: 0,
    includesCompactionHandoff: false,
    preparedThroughSeq,
    contextUpdatedAt: null,
    updatedAt: nowIso(),
    source: 'history',
  };
}

async function getOrPrepareForkContext(sessionId, snapshot, contextHead) {
  const prepared = await getForkContext(sessionId);
  if (isPreparedForkContextCurrent(prepared, snapshot, contextHead)) {
    return prepared;
  }

  const next = await prepareForkContextSnapshot(sessionId, snapshot, contextHead);
  if (next) {
    await setForkContext(sessionId, next);
    return next;
  }

  await clearForkContext(sessionId);
  return null;
}

function buildDelegationHandoff({
  source,
  task,
}) {
  const normalizedTask = clipCompactionSection(task, 4000);
  const sourceId = typeof source?.id === 'string' ? source.id.trim() : '';
  const lines = [normalizedTask || '(no delegated task provided)'];
  if (sourceId) {
    lines.push('', `Parent session id: ${sourceId}`);
  }
  return lines.join('\n');
}


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
  const sliceEvents = boundedHistory.filter((event) => (event?.seq || 0) > activeFromSeq);
  const existingSummary = typeof contextHead?.summary === 'string' ? contextHead.summary.trim() : '';
  const conversationBody = prepareConversationOnlyContinuationBody(sliceEvents);
  const toolIndex = buildToolActivityIndex(boundedHistory);

  if (!existingSummary && !conversationBody && !toolIndex) {
    return null;
  }

  return {
    targetSeq,
    existingSummary,
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

function resolveResumeState(toolId, session, options = {}) {
  if (options.freshThread === true) {
    return {
      hasResume: false,
      claudeSessionId: null,
      codexThreadId: null,
    };
  }

  const tool = typeof toolId === 'string' ? toolId.trim() : '';
  if (tool === 'claude') {
    const claudeSessionId = session?.claudeSessionId || null;
    return {
      hasResume: !!claudeSessionId,
      claudeSessionId,
      codexThreadId: null,
    };
  }

  if (tool === 'codex') {
    const codexThreadId = session?.codexThreadId || null;
    return {
      hasResume: !!codexThreadId,
      claudeSessionId: null,
      codexThreadId,
    };
  }

  return {
    hasResume: false,
    claudeSessionId: null,
    codexThreadId: null,
  };
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

function buildPromptSection(title, body) {
  const sectionTitle = typeof title === 'string' ? title.trim() : '';
  const sectionBody = typeof body === 'string' ? body.trim() : '';
  if (!sectionTitle || !sectionBody) return '';
  return `[${sectionTitle}]\n\n${sectionBody}`;
}

export async function buildPrompt(sessionId, session, text, previousTool, effectiveTool, snapshot = null, options = {}) {
  const toolDefinition = await getToolDefinitionAsync(effectiveTool);
  const promptMode = toolDefinition?.promptMode === 'bare-user'
    ? 'bare-user'
    : 'default';
  const flattenPrompt = toolDefinition?.flattenPrompt === true;
  const { hasResume } = resolveResumeState(effectiveTool, session, options);
  let continuationContext = '';
  let contextToolIndex = '';

  if (!hasResume && options.skipSessionContinuation !== true) {
    const contextHead = await getContextHead(sessionId);
    contextToolIndex = typeof contextHead?.toolIndex === 'string' ? contextHead.toolIndex.trim() : '';
    const prepared = await getOrPrepareForkContext(
      sessionId,
      snapshot || await getHistorySnapshot(sessionId),
      contextHead,
    );
    continuationContext = buildPreparedContinuationContext(prepared, previousTool, effectiveTool, session?.sessionState || null);
  }

  let actualText = text;
  if (promptMode === 'default') {
    const turnSections = [];
    const promptTaskCard = session?.taskCard || projectTaskCardFromSessionState(session?.sessionState, {
      sessionTitle: session?.name || '',
    });
    const taskCardPromptBlock = options.internalOperation
      ? ''
      : buildTaskCardPromptBlock(promptTaskCard, {
          sessionTitle: session?.name || '',
        });

    if (continuationContext) {
      turnSections.push(buildPromptSection('Session continuity', continuationContext));
    }
    if (contextToolIndex) {
      turnSections.push(buildPromptSection('Earlier tool activity index', contextToolIndex));
    }
    turnSections.push(`Current user message:\n${text}`);
    if (taskCardPromptBlock) {
      turnSections.push(taskCardPromptBlock);
    }

    actualText = turnSections.join('\n\n---\n\n');

    if (!hasResume) {
      const systemContext = await buildSystemContext({ sessionId });
      const preambleSections = [buildPromptSection('Manager context', systemContext)];
      const sourceRuntimePrompt = buildSourceRuntimePrompt(session);
      if (sourceRuntimePrompt) {
        preambleSections.push(buildPromptSection('Source/runtime instructions', sourceRuntimePrompt));
      }
      if (session.systemPrompt) {
        preambleSections.push(buildPromptSection('App instructions', session.systemPrompt));
      }
      actualText = [...preambleSections, actualText].filter(Boolean).join('\n\n---\n\n');
    }

  } else if (flattenPrompt) {
    actualText = actualText.replace(/\s+/g, ' ').trim();
  }

  if (flattenPrompt && promptMode === 'default') {
    actualText = actualText.replace(/\s+/g, ' ').trim();
  }

  return actualText;
}

function sanitizeAssistantRunEvents(events = []) {
  let latestTaskCard = null;
  const sanitizedEvents = (Array.isArray(events) ? events : []).map((event) => {
    if (event?.type !== 'message' || event.role !== 'assistant') {
      return event;
    }

    const content = typeof event.content === 'string' ? event.content : '';
    const parsedTaskCard = parseTaskCardFromAssistantContent(content);
    if (!parsedTaskCard) {
      return event;
    }

    latestTaskCard = parsedTaskCard;

    return {
      ...event,
      taskCard: parsedTaskCard,
    };
  });

  return { sanitizedEvents, latestTaskCard };
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
  const shouldPreserveManagedSummary = managedBindingKeys.has('summary');
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
      summary: shouldPreserveManagedSummary
        ? parsedTaskCard.summary
        : (currentTaskCard?.summary || parsedTaskCard.summary),
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
  let contextTokens = getRunLiveContextTokens(run);
  let autoCompactTokens = getAutoCompactContextTokens(run);
  if (!Number.isInteger(contextTokens) || !Number.isFinite(autoCompactTokens)) {
    const refreshed = await refreshCodexContextMetrics(run);
    if (refreshed) {
      const syntheticRun = {
        ...run,
        contextInputTokens: refreshed.contextTokens,
        ...(Number.isInteger(refreshed.contextWindowTokens)
          ? { contextWindowTokens: refreshed.contextWindowTokens }
          : {}),
      };
      contextTokens = refreshed.contextTokens;
      autoCompactTokens = getAutoCompactContextTokens(syntheticRun);
    }
  }
  if (!Number.isInteger(contextTokens) || !Number.isFinite(autoCompactTokens)) return false;
  if (contextTokens <= autoCompactTokens) return false;
  return queueContextCompaction(sessionId, session, run, { automatic: true });
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
    summary,
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

export async function startDetachedRunObservers() {
  ensureSessionManagerBuiltinHooksRegistered();
  console.log('startup: startDetachedRunObservers enter');
  const sessionMetaList = await loadSessionsMeta();
  console.log(`startup: startDetachedRunObservers loaded ${sessionMetaList.length} sessions`);
  for (const meta of sessionMetaList) {
    const sessionId = trimString(meta?.id);
    const runId = trimString(meta?.activeRunId);
    if (!sessionId || !runId) {
      continue;
    }

    const startTs = Date.now();
    let run = await getRun(runId);

    if (run && !isTerminalRunState(run.state)) {
      observeDetachedRun(sessionId, runId, { initialSync: false });
      console.log(`Startup observed active detached run for session ${sessionId} (run ${runId})`);
      continue;
    }

    if (run && isTerminalRunState(run.state)) {
      if (!run.finalizedAt) {
        void syncDetachedRun(sessionId, runId).finally(() => {
          if (STARTUP_SYNC_DEBUG) {
            console.log(`Startup finalize-sync for completed run ${runId} in session ${sessionId} completed in ${Date.now() - startTs}ms`);
          }
        }).catch((error) => {
          console.error(`Failed to sync completed detached run for session ${sessionId} (run ${runId}): ${error.message}`);
        });
        if (getFollowUpQueueCount(meta) > 0) {
          scheduleQueuedFollowUpDispatch(sessionId);
        }
        continue;
      }
      if (getFollowUpQueueCount(meta) > 0) {
        scheduleQueuedFollowUpDispatch(sessionId);
      }
      continue;
    }

    void syncDetachedRun(sessionId, runId).finally(() => {
      if (STARTUP_SYNC_DEBUG) {
        console.log(`Startup sync for session ${sessionId} completed in ${Date.now() - startTs}ms`);
      }
    }).catch((error) => {
      console.error(`Failed to sync detached run for session ${sessionId} (run ${runId}): ${error.message}`);
    });

    if (getFollowUpQueueCount(meta) > 0) {
      scheduleQueuedFollowUpDispatch(meta.id);
    }
  }
  await emitHook('instance.resume', {
    sessionId: '',
    session: null,
    manifest: null,
  });
}

export async function listSessions({
  includeArchived = true,
  sourceId = '',
  includeQueuedMessages = false,
} = {}) {
  const metas = await reconcileSessionsMetaList(await loadSessionsMeta());
  const normalizedSourceId = normalizeAppId(sourceId);
  const filtered = metas
    .filter((meta) => shouldExposeSession(meta))
    .filter((meta) => includeArchived || !meta.archived)
    .filter((meta) => !normalizedSourceId || resolveSessionSourceId(meta) === normalizedSourceId)
    .sort((a, b) => (
      getSessionPinSortRank(b) - getSessionPinSortRank(a)
      || getSessionSortTime(b) - getSessionSortTime(a)
    ));
  return Promise.all(filtered.map((meta) => enrichSessionMetaForClient(meta, {
    includeQueuedMessages,
  })));
}

export async function getSession(id, options = {}) {
  const metas = await loadSessionsMeta();
  const meta = metas.find((entry) => entry.id === id) || await findSessionMeta(id);
  if (!meta) return null;
  return enrichSessionMetaForClient(await reconcileSessionMeta(meta), options);
}

export async function getSessionEventsAfter(sessionId, afterSeq = 0, options = {}) {
  const events = await buildSessionTimelineEvents(sessionId, {
    includeBodies: options?.includeBodies !== false,
  });
  const filtered = (Array.isArray(events) ? events : []).filter((event) => Number.isInteger(event?.seq) && event.seq > afterSeq);
  if (options?.includeAttachmentPaths === true) return filtered;
  return filtered.map((event) => stripEventAttachmentSavedPaths(event));
}

export async function getSessionTimelineEvents(sessionId, options = {}) {
  return buildSessionTimelineEvents(sessionId, options);
}

export async function getSessionSourceContext(sessionId, options = {}) {
  const session = await getSession(sessionId);
  if (!session) return null;
  const requestedRequestId = typeof options.requestId === 'string' ? options.requestId.trim() : '';
  const events = await loadHistory(sessionId, { includeBodies: false });
  let matchedRequestId = requestedRequestId;
  let messageContext = null;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'message' || event.role !== 'user') continue;
    if (requestedRequestId && (event.requestId || '') !== requestedRequestId) continue;
    const candidate = normalizeSourceContext(event.sourceContext);
    if (!candidate) continue;
    messageContext = candidate;
    matchedRequestId = event.requestId || matchedRequestId;
    break;
  }

  return {
    session: normalizeSourceContext(session.sourceContext),
    message: messageContext,
    requestId: matchedRequestId,
  };
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
  ensureSessionManagerBuiltinHooksRegistered();
  const normalizedFolder = canonicalizeSessionFolder(folder);
  const externalTriggerId = typeof extra.externalTriggerId === 'string' ? extra.externalTriggerId.trim() : '';
  const {
    requestedSourceId,
    requestedSourceName,
    requestedUserId,
    requestedUserName,
  } = normalizeSessionCompatInput(extra);
  const requestedGroup = normalizeSessionGroup(extra.group || '');
  const requestedDescription = normalizeSessionDescription(extra.description || '');
  const hasRequestedSystemPrompt = Object.prototype.hasOwnProperty.call(extra, 'systemPrompt');
  const requestedSystemPrompt = typeof extra.systemPrompt === 'string' ? extra.systemPrompt : '';
  const hasRequestedModel = Object.prototype.hasOwnProperty.call(extra, 'model');
  const requestedModel = typeof extra.model === 'string' ? extra.model.trim() : '';
  const hasRequestedEffort = Object.prototype.hasOwnProperty.call(extra, 'effort');
  const requestedEffort = typeof extra.effort === 'string' ? extra.effort.trim() : '';
  const hasRequestedThinking = Object.prototype.hasOwnProperty.call(extra, 'thinking');
  const requestedThinking = extra.thinking === true;
  const requestedPersistent = Object.prototype.hasOwnProperty.call(extra, 'persistent') && extra.persistent
    ? extra.persistent
    : null;
  const hasRequestedSourceContext = Object.prototype.hasOwnProperty.call(extra, 'sourceContext');
  const requestedSourceContext = normalizeSourceContext(extra.sourceContext);
  const hasRequestedActiveAgreements = Object.prototype.hasOwnProperty.call(extra, 'activeAgreements');
  const requestedActiveAgreements = hasRequestedActiveAgreements
    ? normalizeSessionAgreements(extra.activeAgreements || [])
    : [];
  const normalizedPersistent = requestedPersistent && typeof requestedPersistent === 'object' && !Array.isArray(requestedPersistent)
    ? normalizeSessionPersistent(requestedPersistent)
    : null;
  const requestedInitialNaming = resolveInitialSessionName(name, {
    group: requestedGroup,
    sourceId: requestedSourceId,
    sourceName: requestedSourceName,
    externalTriggerId,
  });
  const created = await withSessionsMetaMutation(async (metas, saveSessionsMeta) => {
    if (externalTriggerId) {
      const existingIndex = metas.findIndex((meta) => meta.externalTriggerId === externalTriggerId && !meta.archived);
      if (existingIndex !== -1) {
        const existing = metas[existingIndex];
        const updated = { ...existing };
        let changed = false;

        if (requestedGroup && updated.group !== requestedGroup) {
          updated.group = requestedGroup;
          changed = true;
        }

        if (requestedDescription && updated.description !== requestedDescription) {
          updated.description = requestedDescription;
          changed = true;
        }

        if (updated.folder !== normalizedFolder) {
          updated.folder = normalizedFolder;
          changed = true;
        }

        const refreshedInitialNaming = resolveInitialSessionName(name, {
          group: requestedGroup || updated.group || '',
          sourceId: requestedSourceId || updated.sourceId || '',
          sourceName: requestedSourceName || updated.sourceName || '',
          externalTriggerId: externalTriggerId || updated.externalTriggerId || '',
        });
        if (isSessionAutoRenamePending(updated) && !refreshedInitialNaming.autoRenamePending) {
          if (updated.name !== refreshedInitialNaming.name || updated.autoRenamePending !== false) {
            updated.name = refreshedInitialNaming.name;
            updated.autoRenamePending = false;
            changed = true;
          }
        }

        const workflowState = normalizeSessionWorkflowState(extra.workflowState || '');
        if (workflowState && updated.workflowState !== workflowState) {
          updated.workflowState = workflowState;
          changed = true;
        }

        const workflowPriority = normalizeSessionWorkflowPriority(extra.workflowPriority || '');
        if (workflowPriority && updated.workflowPriority !== workflowPriority) {
          updated.workflowPriority = workflowPriority;
          changed = true;
        }

        if (requestedSourceId && updated.sourceId !== requestedSourceId) {
          updated.sourceId = requestedSourceId;
          changed = true;
        }

        if (requestedSourceName && updated.sourceName !== requestedSourceName) {
          updated.sourceName = requestedSourceName;
          changed = true;
        }

        if (requestedUserId && updated.userId !== requestedUserId) {
          updated.userId = requestedUserId;
          changed = true;
        }

        if (requestedUserName && updated.userName !== requestedUserName) {
          updated.userName = requestedUserName;
          changed = true;
        }

        if (hasRequestedSystemPrompt && (updated.systemPrompt || '') !== requestedSystemPrompt) {
          if (requestedSystemPrompt) updated.systemPrompt = requestedSystemPrompt;
          else delete updated.systemPrompt;
          changed = true;
        }

        if (hasRequestedModel && (updated.model || '') !== requestedModel) {
          if (requestedModel) updated.model = requestedModel;
          else delete updated.model;
          changed = true;
        }

        if (hasRequestedEffort && (updated.effort || '') !== requestedEffort) {
          if (requestedEffort) updated.effort = requestedEffort;
          else delete updated.effort;
          changed = true;
        }

        if (hasRequestedThinking && updated.thinking !== requestedThinking) {
          if (requestedThinking) updated.thinking = true;
          else delete updated.thinking;
          changed = true;
        }

        const completionTargets = sanitizeEmailCompletionTargets(extra.completionTargets || []);
        if (completionTargets.length > 0 && JSON.stringify(updated.completionTargets || []) !== JSON.stringify(completionTargets)) {
          updated.completionTargets = completionTargets;
          changed = true;
        }

        if (hasRequestedActiveAgreements) {
          if (JSON.stringify(normalizeSessionAgreements(updated.activeAgreements || [])) !== JSON.stringify(requestedActiveAgreements)) {
            if (requestedActiveAgreements.length > 0) updated.activeAgreements = requestedActiveAgreements;
            else delete updated.activeAgreements;
            changed = true;
          }
        }

        if (hasRequestedSourceContext) {
          const currentSourceContext = normalizeSourceContext(updated.sourceContext);
          if (JSON.stringify(currentSourceContext) !== JSON.stringify(requestedSourceContext)) {
            if (requestedSourceContext) updated.sourceContext = requestedSourceContext;
            else delete updated.sourceContext;
            changed = true;
          }
        }

        const beforeCompat = JSON.stringify({
          appId: updated.appId || '',
          appName: updated.appName || '',
          sourceId: updated.sourceId || '',
          sourceName: updated.sourceName || '',
          userId: updated.userId || '',
          userName: updated.userName || '',
        });
        applySessionCompatFields(updated, {
          requestedSourceId,
          requestedSourceName,
          requestedUserId,
          requestedUserName,
        });
        if (JSON.stringify({
          appId: updated.appId || '',
          appName: updated.appName || '',
          sourceId: updated.sourceId || '',
          sourceName: updated.sourceName || '',
          userId: updated.userId || '',
          userName: updated.userName || '',
        }) !== beforeCompat) {
          changed = true;
        }

        if (changed) {
          updated.updatedAt = nowIso();
          metas[existingIndex] = updated;
          await saveSessionsMeta(metas);
          return { session: updated, created: false, changed: true };
        }

        return { session: existing, created: false, changed: false };
      }
    }

    const id = generateId();
    const initialNaming = requestedInitialNaming;
    const now = nowIso();
    const workflowState = normalizeSessionWorkflowState(extra.workflowState || '');
    const workflowPriority = normalizeSessionWorkflowPriority(extra.workflowPriority || '');
    const completionTargets = sanitizeEmailCompletionTargets(extra.completionTargets || []);

    const session = {
      id,
      folder: normalizedFolder,
      tool,
      name: initialNaming.name,
      autoRenamePending: initialNaming.autoRenamePending,
      created: now,
      updatedAt: now,
    };
    applySessionCompatFields(session, {
      requestedSourceId,
      requestedSourceName,
      requestedUserId,
      requestedUserName,
    });

    if (requestedGroup) session.group = requestedGroup;
    if (requestedDescription) session.description = requestedDescription;
    if (workflowState) session.workflowState = workflowState;
    if (workflowPriority) session.workflowPriority = workflowPriority;
    if (requestedSystemPrompt) session.systemPrompt = requestedSystemPrompt;
    if (requestedModel) session.model = requestedModel;
    if (requestedEffort) session.effort = requestedEffort;
    if (requestedThinking) session.thinking = true;
    if (extra.internalRole) session.internalRole = extra.internalRole;
    if (extra.compactsSessionId) session.compactsSessionId = extra.compactsSessionId;
    if (externalTriggerId) session.externalTriggerId = externalTriggerId;
    if (requestedSourceContext) session.sourceContext = requestedSourceContext;
    if (extra.forkedFromSessionId) session.forkedFromSessionId = extra.forkedFromSessionId;
    if (Number.isInteger(extra.forkedFromSeq)) session.forkedFromSeq = extra.forkedFromSeq;
    if (extra.rootSessionId) session.rootSessionId = extra.rootSessionId;
    if (extra.forkedAt) session.forkedAt = extra.forkedAt;
    if (completionTargets.length > 0) session.completionTargets = completionTargets;
    if (hasRequestedActiveAgreements && requestedActiveAgreements.length > 0) {
      session.activeAgreements = requestedActiveAgreements;
    }
    if (normalizedPersistent) {
      session.persistent = normalizedPersistent;
    }

    metas.push(session);
    await saveSessionsMeta(metas);
    return { session, created: true, changed: true };
  });

  if ((created.created || created.changed) && shouldExposeSession(created.session)) {
    broadcastSessionsInvalidation();
  }

  const enriched = await enrichSessionMeta(created.session);
  if (created.created) {
    await emitHook('session.created', {
      sessionId: enriched.id,
      session: enriched,
      manifest: null,
    });
  }
  await appendGraphBootstrapPromptContext({
    sessionId: enriched.id,
    session: enriched,
    appendEvents,
    loadHistory,
  });
  return enriched;
}

export async function setSessionArchived(id, archived = true) {
  const shouldArchive = archived === true;
  const current = await findSessionMeta(id);
  if (!current) return null;

  const result = await mutateSessionMeta(id, (session) => {
    const isArchived = session.archived === true;
    if (isArchived === shouldArchive) return false;
    if (shouldArchive) {
      session.archived = true;
      delete session.pinned;
      session.archivedAt = nowIso();
      return true;
    }
    delete session.archived;
    delete session.archivedAt;
    return true;
  });

  if (!result.meta) return null;
  if (!result.changed) {
    return enrichSessionMeta(result.meta);
  }

  if (shouldExposeSession(current)) {
    broadcastSessionsInvalidation();
  }
  broadcastSessionInvalidation(id);
  return enrichSessionMeta(result.meta);
}

function collectSessionTreeIds(rootSessionId, metas = []) {
  const queue = [rootSessionId];
  const collected = [];
  const seen = new Set();

  while (queue.length > 0) {
    const sessionId = queue.shift();
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    collected.push(sessionId);
    for (const meta of Array.isArray(metas) ? metas : []) {
      const parentSessionId = typeof meta?.sourceContext?.parentSessionId === 'string'
        ? meta.sourceContext.parentSessionId.trim()
        : '';
      if (parentSessionId && parentSessionId === sessionId && meta?.id && !seen.has(meta.id)) {
        queue.push(meta.id);
      }
    }
  }

  return collected;
}

function isManagedSessionPath(candidatePath, managedDir) {
  const target = trimString(candidatePath);
  const baseDir = trimString(managedDir);
  if (!target || !baseDir) return false;
  const resolvedTarget = resolve(target);
  const resolvedBase = resolve(baseDir);
  return resolvedTarget === resolvedBase
    || resolvedTarget.startsWith(`${resolvedBase}/`)
    || resolvedTarget.startsWith(`${resolvedBase}\\`);
}

function collectSessionManagedArtifacts(historiesBySessionId = {}, sessionIds = []) {
  const managedPaths = new Set();
  const fileAssetIds = new Set();

  for (const sessionId of Array.isArray(sessionIds) ? sessionIds : []) {
    const events = Array.isArray(historiesBySessionId[sessionId]) ? historiesBySessionId[sessionId] : [];
    for (const event of events) {
      if (!Array.isArray(event?.images)) continue;
      for (const image of event.images) {
        const savedPath = trimString(image?.savedPath);
        const assetId = trimString(image?.assetId);
        if (savedPath && (
          isManagedSessionPath(savedPath, CHAT_IMAGES_DIR)
          || isManagedSessionPath(savedPath, CHAT_FILE_ASSET_CACHE_DIR)
        )) {
          managedPaths.add(savedPath);
        }
        if (assetId) {
          fileAssetIds.add(assetId);
        }
      }
    }
  }

  return {
    managedPaths: [...managedPaths],
    fileAssetIds: [...fileAssetIds],
  };
}

async function collectRunPublishedFileAssetIds(sessionIds = []) {
  const targets = new Set((Array.isArray(sessionIds) ? sessionIds : []).filter(Boolean));
  if (!targets.size) return [];
  const fileAssetIds = new Set();
  const runIds = await listRunIds();
  for (const runId of runIds) {
    const run = await getRun(runId);
    if (!run?.sessionId || !targets.has(run.sessionId)) continue;
    for (const attachment of normalizePublishedResultAssetAttachments(run?.publishedResultAssets || [])) {
      if (trimString(attachment?.assetId)) {
        fileAssetIds.add(trimString(attachment.assetId));
      }
    }
  }
  return [...fileAssetIds];
}

async function pruneWorkbenchSessionArtifacts(sessionIds = []) {
  const targetIds = new Set((Array.isArray(sessionIds) ? sessionIds : []).filter(Boolean));
  if (!targetIds.size) return;

  await workbenchQueue(async () => {
    const state = await loadWorkbenchState();
    const removedProjectIds = new Set(
      (state.projects || [])
        .filter((entry) => targetIds.has(trimString(entry?.scopeKey)))
        .map((entry) => trimString(entry?.id))
        .filter(Boolean),
    );

    state.projects = (state.projects || []).filter((entry) => !targetIds.has(trimString(entry?.scopeKey)));
    state.branchContexts = (state.branchContexts || []).filter((entry) => (
      !targetIds.has(trimString(entry?.sessionId))
      && !targetIds.has(trimString(entry?.parentSessionId))
    ));
    state.taskMapPlans = (state.taskMapPlans || []).flatMap((plan) => {
      if (targetIds.has(trimString(plan?.rootSessionId))) {
        return [];
      }
      const removedNodeIds = new Set(
        (Array.isArray(plan?.nodes) ? plan.nodes : [])
          .filter((node) => (
            targetIds.has(trimString(node?.sessionId))
            || targetIds.has(trimString(node?.sourceSessionId))
          ))
          .map((node) => trimString(node?.id))
          .filter(Boolean),
      );
      if (!removedNodeIds.size) {
        return [plan];
      }
      const nodes = (plan.nodes || []).filter((node) => !removedNodeIds.has(trimString(node?.id)));
      if (!nodes.length) {
        return [];
      }
      const nodeIds = new Set(nodes.map((node) => trimString(node?.id)).filter(Boolean));
      const edges = (plan.edges || []).filter((edge) => (
        nodeIds.has(trimString(edge?.fromNodeId))
        && nodeIds.has(trimString(edge?.toNodeId))
      ));
      return [{
        ...plan,
        nodes,
        edges,
        activeNodeId: nodeIds.has(trimString(plan?.activeNodeId))
          ? trimString(plan.activeNodeId)
          : trimString(nodes[0]?.id),
      }];
    });
    state.nodes = (state.nodes || []).filter((entry) => !removedProjectIds.has(trimString(entry?.projectId)));
    state.summaries = (state.summaries || []).filter((entry) => !removedProjectIds.has(trimString(entry?.projectId)));

    await saveWorkbenchState(state);
  });
}

async function deleteSessionRuns(sessionIds = []) {
  const targets = new Set((Array.isArray(sessionIds) ? sessionIds : []).filter(Boolean));
  if (!targets.size) return;
  const runIds = await listRunIds();
  for (const runId of runIds) {
    const run = await getRun(runId);
    if (!run?.sessionId || !targets.has(run.sessionId)) continue;
    runSyncPromises.delete(runId);
    observedRuns.delete(runId);
    await removePath(runDir(runId));
  }
}

function assertSessionCanBeDeletedPermanently(session) {
  if (session?.archived === true) return;
  const error = new Error('请先归档任务，再删除。');
  error.statusCode = 409;
  throw error;
}

async function buildPermanentSessionDeletionPlan(rootSessionId, current) {
  const metas = await loadSessionsMeta();
  const targetTreeIds = collectSessionTreeIds(rootSessionId, metas);
  if (!targetTreeIds.length) return null;
  const targetIdSet = new Set(targetTreeIds);
  const rootSession = metas.find((meta) => meta?.id === rootSessionId) || current;
  const relatedSessions = metas.filter((meta) => meta?.id && targetIdSet.has(meta.id) && meta.id !== rootSessionId);
  const historyEntries = await Promise.all(targetTreeIds.map(async (sessionId) => [
    sessionId,
    await loadHistory(sessionId, { includeBodies: true }).catch(() => []),
  ]));
  const historiesBySessionId = Object.fromEntries(historyEntries);
  return {
    rootSession,
    relatedSessions,
    targetTreeIds,
    targetIdSet,
    historiesBySessionId,
    deletionArtifacts: collectSessionManagedArtifacts(historiesBySessionId, targetTreeIds),
    runFileAssetIds: await collectRunPublishedFileAssetIds(targetTreeIds),
  };
}

async function deleteSessionTreeMetadata(targetIdSet) {
  return withSessionsMetaMutation(async (metas, saveSessionsMeta) => {
    const treeIds = metas
      .map((meta) => trimString(meta?.id))
      .filter((sessionId) => sessionId && targetIdSet.has(sessionId));
    if (!treeIds.length) return [];
    const matchedIds = new Set(treeIds);
    const nextMetas = metas.filter((meta) => !matchedIds.has(meta?.id));
    metas.splice(0, metas.length, ...nextMetas);
    await saveSessionsMeta(metas);
    return treeIds;
  });
}

async function clearDeletedSessionRuntimeState(sessionIds = []) {
  for (const sessionId of Array.isArray(sessionIds) ? sessionIds : []) {
    liveSessions.delete(sessionId);
    clearRenameState(sessionId);
    await clearSessionHistory(sessionId);
    await clearContextHead(sessionId).catch(() => {});
    await clearForkContext(sessionId).catch(() => {});
  }
}

async function deletePermanentSessionArtifacts(sessionIds = [], {
  managedPaths = [],
  fileAssetIds = [],
  runFileAssetIds = [],
} = {}) {
  await deleteSessionRuns(sessionIds);
  await pruneWorkbenchSessionArtifacts(sessionIds).catch(() => {});

  for (const managedPath of managedPaths) {
    await removePath(managedPath).catch(() => {});
  }
  await deleteFileAssets([
    ...fileAssetIds,
    ...runFileAssetIds,
  ]).catch(() => {});
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

  await writeSessionDeletionJournalEntry({
    rootSession: deletionPlan.rootSession,
    relatedSessions: deletionPlan.relatedSessions,
    historiesBySessionId: deletionPlan.historiesBySessionId,
    deletedSessionIds: deletionPlan.targetTreeIds,
  });

  const deletedSessionIds = await deleteSessionTreeMetadata(deletionPlan.targetIdSet);
  if (!deletedSessionIds.length) {
    return { deletedSessionIds: [] };
  }

  await clearDeletedSessionRuntimeState(deletedSessionIds);
  await deletePermanentSessionArtifacts(deletedSessionIds, {
    managedPaths: deletionPlan.deletionArtifacts.managedPaths,
    fileAssetIds: deletionPlan.deletionArtifacts.fileAssetIds,
    runFileAssetIds: deletionPlan.runFileAssetIds,
  });
  broadcastPermanentSessionDeletion(current, deletedSessionIds);

  return { deletedSessionIds };
}

export async function setSessionPinned(id, pinned = true) {
  const shouldPin = pinned === true;
  const result = await mutateSessionMeta(id, (session) => {
    if (session.archived && shouldPin) return false;
    const isPinned = session.pinned === true;
    if (isPinned === shouldPin) return false;
    if (shouldPin) {
      session.pinned = true;
    } else {
      delete session.pinned;
    }
    return true;
  });

  if (!result.meta) return null;
  if (result.changed && shouldExposeSession(result.meta)) {
    broadcastSessionsInvalidation();
  }
  if (result.changed) {
    broadcastSessionInvalidation(id);
  }
  return enrichSessionMeta(result.meta);
}

export async function renameSession(id, name, options = {}) {
  const nextName = typeof name === 'string' ? name.trim() : '';
  if (!nextName) return null;

  const result = await mutateSessionMeta(id, (session) => {
    const preserveAutoRename = options.preserveAutoRename === true;
    const nextPending = preserveAutoRename;
    const changed = session.name !== nextName || session.autoRenamePending !== nextPending;
    if (!changed) return false;
    session.name = nextName;
    session.autoRenamePending = nextPending;
    session.updatedAt = nowIso();
    return true;
  });

  if (!result.meta) return null;
  clearRenameState(id);
  broadcastSessionInvalidation(id);
  return enrichSessionMeta(result.meta);
}

export async function updateSessionGrouping(id, patch = {}) {
  const result = await mutateSessionMeta(id, (session) => {
    let changed = false;
    if (Object.prototype.hasOwnProperty.call(patch, 'group')) {
      const nextGroup = normalizeSessionGroup(patch.group || '');
      if (nextGroup) {
        if (session.group !== nextGroup) {
          session.group = nextGroup;
          changed = true;
        }
      } else if (session.group) {
        delete session.group;
        changed = true;
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
      const nextDescription = normalizeSessionDescription(patch.description || '');
      if (nextDescription) {
        if (session.description !== nextDescription) {
          session.description = nextDescription;
          changed = true;
        }
      } else if (session.description) {
        delete session.description;
        changed = true;
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'sidebarOrder')) {
      const nextSidebarOrder = normalizeSessionSidebarOrder(patch.sidebarOrder);
      if (nextSidebarOrder) {
        if (session.sidebarOrder !== nextSidebarOrder) {
          session.sidebarOrder = nextSidebarOrder;
          changed = true;
        }
      } else if (session.sidebarOrder) {
        delete session.sidebarOrder;
        changed = true;
      }
    }
    if (changed) {
      session.updatedAt = nowIso();
    }
    return changed;
  });

  if (!result.meta) return null;
  if (result.changed) {
    broadcastSessionInvalidation(id);
  }
  return enrichSessionMeta(result.meta);
}

export async function updateSessionTaskCard(id, taskCard, options = {}) {
  const result = await mutateSessionMeta(id, (session) => {
    const nextManagedBindings = normalizeSessionTaskCardManagedBindings(options?.managedBindingKeys);
    const currentManagedBindings = normalizeSessionTaskCardManagedBindings(session.taskCardManagedBindings);
    const currentTaskCard = stabilizeSessionTaskCard(session, session.taskCard, {
      managedBindingKeys: currentManagedBindings,
    });
    const nextTaskCard = stabilizeSessionTaskCard(session, taskCard, {
      ...options,
      managedBindingKeys: nextManagedBindings,
    });
    const managedBindingsChanged = JSON.stringify(currentManagedBindings) !== JSON.stringify(nextManagedBindings);
    const nextSessionState = resolveSessionStateFromSession({
      ...session,
      taskCard: nextTaskCard || null,
    });
    const hasMeaningfulSessionState = nextSessionState && (
      nextSessionState.goal
      || nextSessionState.mainGoal
      || nextSessionState.checkpoint
      || nextSessionState.needsUser === true
      || nextSessionState.lineRole === 'branch'
      || nextSessionState.branchFrom
    );
    const currentSessionStateJson = JSON.stringify(session.sessionState || null);
    const nextSessionStateJson = JSON.stringify(hasMeaningfulSessionState ? nextSessionState : null);
    if (
      JSON.stringify(currentTaskCard) === JSON.stringify(nextTaskCard)
      && !managedBindingsChanged
      && currentSessionStateJson === nextSessionStateJson
    ) {
      return false;
    }

    if (nextTaskCard) {
      session.taskCard = nextTaskCard;
    } else if (session.taskCard) {
      delete session.taskCard;
    }

    if (nextManagedBindings.length > 0) {
      session.taskCardManagedBindings = nextManagedBindings;
    } else if (session.taskCardManagedBindings) {
      delete session.taskCardManagedBindings;
    }

    if (hasMeaningfulSessionState) {
      session.sessionState = nextSessionState;
    } else if (session.sessionState) {
      delete session.sessionState;
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

function mergeObjectShape(current, patch) {
  const currentValue = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const patchValue = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  return { ...currentValue, ...patchValue };
}

function getPersistentSessionGroup(kind = '') {
  const normalizedKind = typeof kind === 'string' ? kind.trim().toLowerCase() : '';
  if (normalizedKind === 'skill') return '快捷按钮';
  if (normalizedKind === 'recurring_task') return '长期任务';
  return '';
}

async function buildSessionPersistentDigest(sessionId, session) {
  const history = await loadHistory(sessionId, { includeBodies: false }).catch(() => []);
  return buildPersistentDigest(session, history);
}

function buildSessionPersistentPatch(currentPersistent, patch = {}) {
  const currentRuntimePolicy = currentPersistent?.runtimePolicy && typeof currentPersistent.runtimePolicy === 'object'
    ? currentPersistent.runtimePolicy
    : {};
  const patchRuntimePolicy = patch?.runtimePolicy && typeof patch.runtimePolicy === 'object'
    ? patch.runtimePolicy
    : {};
  return {
    ...(currentPersistent && typeof currentPersistent === 'object' ? currentPersistent : {}),
    ...(patch && typeof patch === 'object' ? patch : {}),
    digest: mergeObjectShape(currentPersistent?.digest, patch?.digest),
    execution: mergeObjectShape(currentPersistent?.execution, patch?.execution),
    recurring: mergeObjectShape(currentPersistent?.recurring, patch?.recurring || patch?.schedule),
    skill: mergeObjectShape(currentPersistent?.skill, patch?.skill),
    runtimePolicy: {
      ...currentRuntimePolicy,
      ...patchRuntimePolicy,
      manual: mergeObjectShape(currentRuntimePolicy?.manual, patchRuntimePolicy?.manual),
      schedule: mergeObjectShape(currentRuntimePolicy?.schedule, patchRuntimePolicy?.schedule),
    },
  };
}

export async function updateSessionPersistent(id, persistent, options = {}) {
  const currentSession = await getSession(id, { includeQueuedMessages: true });
  if (!currentSession) return null;

  const defaultDigest = options.rebuildDigest === true
    ? await buildSessionPersistentDigest(id, currentSession)
    : (currentSession?.persistent?.digest || await buildSessionPersistentDigest(id, currentSession));
  const recomputeNextRunAt = options.recomputeNextRunAt === true
    || Boolean(persistent?.recurring)
    || Boolean(persistent?.schedule);
  const nextPersistent = persistent === null
    ? null
    : normalizeSessionPersistent(
      buildSessionPersistentPatch(currentSession?.persistent, persistent),
      {
        defaultDigest,
        defaultRuntime: currentSession,
        recomputeNextRunAt,
        referenceTime: options.referenceTime || new Date(),
        defaultTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        now: nowIso(),
      },
    );

  const result = await mutateSessionMeta(id, (session) => {
    const currentNormalized = normalizeSessionPersistent(session.persistent || null, {
      defaultDigest,
      defaultRuntime: session,
      defaultTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    });
    const nextGroup = nextPersistent ? getPersistentSessionGroup(nextPersistent.kind) : '';
    const shouldClearPersistentGroup = !nextPersistent && (session.group === '长期任务' || session.group === '快捷按钮');
    if (
      JSON.stringify(currentNormalized) === JSON.stringify(nextPersistent)
      && (!nextGroup || session.group === nextGroup)
      && !shouldClearPersistentGroup
    ) {
      return false;
    }
    if (nextPersistent) {
      session.persistent = nextPersistent;
      if (nextGroup && session.group !== nextGroup) {
        session.group = nextGroup;
      }
    } else if (session.persistent) {
      delete session.persistent;
      if (session.group === '长期任务' || session.group === '快捷按钮') {
        delete session.group;
      }
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

export async function promoteSessionToPersistent(id, payload = {}) {
  const session = await getSession(id, { includeQueuedMessages: true });
  if (!session) return null;
  if (session.archived === true) {
    throw new Error('Archived sessions cannot become persistent items');
  }
  if (isSessionRunning(session) || getSessionQueueCount(session) > 0) {
    throw new Error('Session is busy');
  }

  const defaultDigest = await buildSessionPersistentDigest(id, session);
  const nextPersistent = normalizeSessionPersistent({
    ...(session?.persistent && typeof session.persistent === 'object' ? session.persistent : {}),
    ...(payload && typeof payload === 'object' ? payload : {}),
    kind: payload?.kind || payload?.type,
    digest: mergeObjectShape(defaultDigest, payload?.digest),
    execution: mergeObjectShape(session?.persistent?.execution, payload?.execution),
    recurring: mergeObjectShape(session?.persistent?.recurring, payload?.recurring || payload?.schedule),
    skill: mergeObjectShape(session?.persistent?.skill, payload?.skill),
    runtimePolicy: {
      ...(session?.persistent?.runtimePolicy && typeof session.persistent.runtimePolicy === 'object'
        ? session.persistent.runtimePolicy
        : {}),
      ...(payload?.runtimePolicy && typeof payload.runtimePolicy === 'object'
        ? payload.runtimePolicy
        : {}),
    },
    promotedAt: session?.persistent?.promotedAt || nowIso(),
    updatedAt: nowIso(),
    state: payload?.state || session?.persistent?.state || 'active',
  }, {
    defaultDigest,
    defaultRuntime: session,
    recomputeNextRunAt: true,
    referenceTime: new Date(),
    defaultTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    now: nowIso(),
  });

  if (!nextPersistent) {
    throw new Error('Invalid persistent configuration');
  }

  const nextName = String(nextPersistent?.digest?.title || session?.name || '').trim() || '未命名长期项';
  const nextGroup = getPersistentSessionGroup(nextPersistent.kind);
  const persistentSession = await createSession(
    session.folder,
    session.tool || '',
    nextName,
    {
      group: nextGroup,
      description: String(nextPersistent?.digest?.summary || '').trim(),
      sourceId: session.sourceId || '',
      sourceName: session.sourceName || '',
      userId: session.userId || '',
      userName: session.userName || '',
      systemPrompt: session.systemPrompt || '',
      model: session.model || '',
      effort: session.effort || '',
      thinking: session.thinking === true,
      activeAgreements: session.activeAgreements || [],
      sourceContext: session.sourceContext || null,
      workflowState: session.workflowState || '',
      workflowPriority: session.workflowPriority || '',
      forkedFromSessionId: session.id,
      forkedFromSeq: session.latestSeq || 0,
      rootSessionId: session.rootSessionId || session.id,
      persistent: nextPersistent,
    },
  );

  if (!persistentSession) return null;
  return persistentSession;
}

export async function runSessionPersistent(id, options = {}) {
  const session = await getSession(id, { includeQueuedMessages: true });
  if (!session) return null;
  const persistent = normalizeSessionPersistent(session?.persistent || null, {
    defaultDigest: await buildSessionPersistentDigest(id, session),
    defaultRuntime: session,
    defaultTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
  });
  if (!persistent) {
    throw new Error('Session is not a persistent item');
  }
  if (session.archived === true) {
    throw new Error('Archived sessions cannot be executed');
  }
  if (persistent.kind === 'recurring_task' && persistent.state !== 'active' && options.triggerKind === 'schedule') {
    throw new Error('Recurring task is paused');
  }
  if (isSessionRunning(session) || getSessionQueueCount(session) > 0) {
    throw new Error('Session is busy');
  }

  const triggerKind = String(options.triggerKind || '').trim().toLowerCase() === 'schedule' ? 'schedule' : 'manual';
  const runtime = resolvePersistentRunRuntime(session, persistent, {
    triggerKind,
    runtime: options.runtime,
  });
  const text = buildPersistentRunMessage(session, persistent, { triggerKind, runPrompt: options.runPrompt || '' });
  const outcome = await submitHttpMessage(id, text, [], {
    requestId: createInternalRequestId(triggerKind === 'schedule' ? 'persistent_schedule' : 'persistent_run'),
    queueIfBusy: false,
    scheduledTriggerId: triggerKind === 'schedule' ? `persistent:${id}` : '',
    ...(runtime?.tool ? { tool: runtime.tool } : {}),
    ...(runtime?.model ? { model: runtime.model } : {}),
    ...(runtime?.effort ? { effort: runtime.effort } : {}),
    thinking: runtime?.thinking === true,
  });
  const referenceTime = new Date();
  await updateSessionPersistent(id, {
    execution: {
      ...(persistent.execution || {}),
      lastTriggerAt: referenceTime.toISOString(),
      lastTriggerKind: triggerKind,
    },
    ...(persistent.kind === 'recurring_task'
      ? {
          recurring: {
            ...(persistent.recurring || {}),
            lastRunAt: referenceTime.toISOString(),
            nextRunAt: computeNextRecurringRunAt(persistent.recurring || {}, referenceTime),
          },
        }
      : {
          skill: {
            ...(persistent.skill || {}),
            lastUsedAt: referenceTime.toISOString(),
          },
        }),
  }, {
    referenceTime,
  }).catch(() => {});
  return outcome;
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

  const nextActiveAgreements = normalizeSessionAgreements(patch.activeAgreements);
  const result = await mutateSessionMeta(id, (session) => {
    const currentActiveAgreements = normalizeSessionAgreements(session.activeAgreements || []);
    if (JSON.stringify(currentActiveAgreements) === JSON.stringify(nextActiveAgreements)) {
      return false;
    }

    if (nextActiveAgreements.length > 0) {
      session.activeAgreements = nextActiveAgreements;
    } else if (session.activeAgreements) {
      delete session.activeAgreements;
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

export async function updateSessionWorkflowState(id, workflowState) {
  return updateSessionWorkflowClassification(id, { workflowState });
}

export async function updateSessionWorkflowPriority(id, workflowPriority) {
  return updateSessionWorkflowClassification(id, { workflowPriority });
}

export async function updateSessionLastReviewedAt(id, lastReviewedAt) {
  const nextLastReviewedAt = normalizeSessionReviewedAt(lastReviewedAt || '');
  const result = await mutateSessionMeta(id, (session) => {
    const currentLastReviewedAt = normalizeSessionReviewedAt(session.lastReviewedAt || '');
    if (nextLastReviewedAt) {
      if (currentLastReviewedAt !== nextLastReviewedAt) {
        session.lastReviewedAt = nextLastReviewedAt;
        return true;
      }
      return false;
    }

    if (currentLastReviewedAt) {
      delete session.lastReviewedAt;
      return true;
    }

    return false;
  });

  if (!result.meta) return null;
  if (result.changed) {
    broadcastSessionInvalidation(id);
  }
  return enrichSessionMeta(result.meta);
}

export async function updateSessionWorkflowClassification(id, payload = {}) {
  const {
    workflowState,
    workflowPriority,
  } = payload;
  const nextWorkflowState = normalizeSessionWorkflowState(workflowState || '');
  const hasWorkflowState = Object.prototype.hasOwnProperty.call(payload, 'workflowState');
  const nextWorkflowPriority = normalizeSessionWorkflowPriority(workflowPriority || '');
  const hasWorkflowPriority = Object.prototype.hasOwnProperty.call(payload, 'workflowPriority');
  let shouldSendCompletionPush = false;
  const result = await mutateSessionMeta(id, (session) => {
    const currentWorkflowState = normalizeSessionWorkflowState(session.workflowState || '');
    const currentWorkflowPriority = normalizeSessionWorkflowPriority(session.workflowPriority || '');
    let changed = false;

    if (hasWorkflowState) {
      if (nextWorkflowState) {
        if (currentWorkflowState !== nextWorkflowState) {
          shouldSendCompletionPush = didSessionWorkflowTransitionToDone(nextWorkflowState, currentWorkflowState);
          session.workflowState = nextWorkflowState;
          changed = true;
        }
      } else if (currentWorkflowState) {
        delete session.workflowState;
        changed = true;
      }
    }

    if (hasWorkflowPriority) {
      if (nextWorkflowPriority) {
        if (currentWorkflowPriority !== nextWorkflowPriority) {
          session.workflowPriority = nextWorkflowPriority;
          changed = true;
        }
      } else if (currentWorkflowPriority) {
        delete session.workflowPriority;
        changed = true;
      }
    }

    return changed;
  });

  if (!result.meta) return null;
  const enriched = await enrichSessionMeta(result.meta);
  if (result.changed) {
    broadcastSessionInvalidation(id);
    let completionNoticeKey = '';
    let completionNoticeRunId = '';
    if (shouldSendCompletionPush) {
      completionNoticeRunId = String(enriched?.activeRunId || '').trim();
      if (!completionNoticeRunId) {
        completionNoticeRunId = await resolveLatestCompletedRunIdForSession(enriched?.id || id);
      }
      completionNoticeKey = buildSessionCompletionNoticeKey(
        enriched?.id || id,
        completionNoticeRunId,
      );
    }
    const eventPayload = {
      sessionId: id,
      session: enriched,
      manifest: null,
      run: completionNoticeRunId ? { id: completionNoticeRunId } : undefined,
      completionNoticeKey,
    };
    if (normalizeSessionWorkflowState(enriched?.workflowState || '') === SESSION_WORKFLOW_STATE_WAITING_USER) {
      await emitHook('session.waiting_user', eventPayload);
    }
    if (shouldSendCompletionPush) {
      await Promise.all([
        emitHook('run.completed', eventPayload),
        emitHook('session.completed', eventPayload),
      ]);
    }
  }
  return enriched;
}

async function updateSessionTool(id, tool) {
  const nextTool = typeof tool === 'string' ? tool.trim() : '';
  if (!nextTool) return null;

  const result = await mutateSessionMeta(id, (session) => {
    if (session.tool === nextTool) return false;
    session.tool = nextTool;
    session.updatedAt = nowIso();
    return true;
  });

  if (!result.meta) return null;
  if (result.changed) {
    broadcastSessionInvalidation(id);
  }
  return enrichSessionMeta(result.meta);
}

export async function updateSessionRuntimePreferences(id, patch = {}) {
  const hasToolPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'tool');
  const hasModelPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'model');
  const hasEffortPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'effort');
  const hasThinkingPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'thinking');
  if (!hasToolPatch && !hasModelPatch && !hasEffortPatch && !hasThinkingPatch) {
    return getSession(id);
  }

  const nextTool = hasToolPatch && typeof patch.tool === 'string'
    ? patch.tool.trim()
    : '';
  let toolChanged = false;

  const result = await mutateSessionMeta(id, (session) => {
    let changed = false;

    if (hasToolPatch && nextTool && session.tool !== nextTool) {
      session.tool = nextTool;
      toolChanged = true;
      changed = true;
    }

    if (hasModelPatch) {
      const nextModel = typeof patch.model === 'string' ? patch.model.trim() : '';
      if ((session.model || '') !== nextModel) {
        session.model = nextModel;
        changed = true;
      }
    }

    if (hasEffortPatch) {
      const nextEffort = typeof patch.effort === 'string' ? patch.effort.trim() : '';
      if ((session.effort || '') !== nextEffort) {
        session.effort = nextEffort;
        changed = true;
      }
    }

    if (hasThinkingPatch) {
      const nextThinking = patch.thinking === true;
      if (session.thinking !== nextThinking) {
        session.thinking = nextThinking;
        changed = true;
      }
    }

    if (changed) {
      session.updatedAt = nowIso();
    }
    return changed;
  });

  if (!result.meta) return null;
  if (!result.changed) {
    return enrichSessionMeta(result.meta);
  }

  broadcastSessionInvalidation(id);
  if (shouldExposeSession(result.meta)) {
    broadcastSessionsInvalidation();
  }
  return enrichSessionMeta(result.meta);
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
  if (effectiveTool === 'codex' && await shouldResetCodexResumeThread(session, options)) {
    options = { ...options, freshThread: true };
    const updatedResumeMeta = await mutateSessionMeta(sessionId, (draft) => {
      if (!draft.codexThreadId) return false;
      delete draft.codexThreadId;
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
  await reconcileSessionMeta(await findSessionMeta(sessionId));
  return loadHistory(sessionId);
}

export async function forkSession(sessionId) {
  const source = await getSession(sessionId);
  if (!source) return null;
  if (isSessionRunning(source)) return null;

  const [history, contextHead, snapshot] = await Promise.all([
    loadHistory(sessionId, { includeBodies: true }),
    getContextHead(sessionId),
    getHistorySnapshot(sessionId),
  ]);
  const forkContext = await getOrPrepareForkContext(sessionId, snapshot, contextHead);

  const child = await createSession(source.folder, source.tool, buildForkSessionName(source), {
    group: source.group || '',
    description: source.description || '',
    sourceId: source.sourceId || '',
    sourceName: source.sourceName || '',
    systemPrompt: source.systemPrompt || '',
    activeAgreements: source.activeAgreements || [],
    userId: source.userId || '',
    userName: source.userName || '',
    forkedFromSessionId: source.id,
    forkedFromSeq: source.latestSeq || 0,
    rootSessionId: source.rootSessionId || source.id,
    forkedAt: nowIso(),
  });
  if (!child) return null;

  const copiedEvents = history
    .map((event) => sanitizeForkedEvent(event))
    .filter(Boolean);
  if (copiedEvents.length > 0) {
    await appendEvents(child.id, copiedEvents);
  }

  if (contextHead) {
    await setContextHead(child.id, {
      ...contextHead,
      updatedAt: contextHead.updatedAt || nowIso(),
    });
  } else {
    await clearContextHead(child.id);
  }

  if (forkContext) {
    await setForkContext(child.id, {
      ...forkContext,
      updatedAt: nowIso(),
    });
  } else {
    await clearForkContext(child.id);
  }

  broadcastSessionsInvalidation();
  return getSession(child.id);
}

export async function delegateSession(sessionId, payload = {}) {
  const source = await getSession(sessionId);
  if (!source) return null;

  const task = typeof payload?.task === 'string' ? payload.task.trim() : '';
  if (!task) {
    throw new Error('task is required');
  }

  const requestedName = typeof payload?.name === 'string' ? payload.name.trim() : '';
  const requestedTool = typeof payload?.tool === 'string' ? payload.tool.trim() : '';
  const runInternally = payload?.internal === true;
  const nextTool = requestedTool || source.tool;
  const inheritRuntimePreferences = !requestedTool || requestedTool === source.tool;

  const child = await createSession(source.folder, nextTool, requestedName || buildDelegatedSessionName(source, task), {
    sourceId: source.sourceId || '',
    sourceName: source.sourceName || '',
    systemPrompt: source.systemPrompt || '',
    activeAgreements: source.activeAgreements || [],
    model: inheritRuntimePreferences ? source.model || '' : '',
    effort: inheritRuntimePreferences ? source.effort || '' : '',
    thinking: inheritRuntimePreferences && source.thinking === true,
    userId: source.userId || '',
    userName: source.userName || '',
    ...(runInternally ? { internalRole: INTERNAL_SESSION_ROLE_AGENT_DELEGATE } : {}),
  });
  if (!child) return null;

  const handoffText = buildDelegationHandoff({
    source,
    task,
  });
  const outcome = await submitHttpMessage(child.id, handoffText, [], {
    requestId: createInternalRequestId('delegate'),
    tool: requestedTool || undefined,
    model: inheritRuntimePreferences ? source.model || undefined : undefined,
    effort: inheritRuntimePreferences ? source.effort || undefined : undefined,
    thinking: inheritRuntimePreferences && source.thinking === true,
  });

  if (!runInternally) {
    await appendEvent(source.id, messageEvent('assistant', buildDelegationNoticeMessage(task, child), undefined, {
      messageKind: 'session_delegate_notice',
    }));
    broadcastSessionInvalidation(source.id);
  }

  return {
    session: outcome.session || await getSession(child.id) || child,
    run: outcome.run || null,
  };
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
