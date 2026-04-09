import assert from 'node:assert/strict';
import { finalizeDetachedRunWithDeps } from '../backend/run/finalization.mjs';
import { createSessionCompactionService } from '../backend/services/session/compaction-service.mjs';

const sessionId = 'sess_direct_compact';
const run = {
  id: 'run_direct_compact',
  sessionId,
  toolId: 'codex',
  state: 'completed',
  contextInputTokens: 321,
};

const appendedEvents = [];
let persistedContextHead = null;

const compactionService = createSessionCompactionService({
  appendEvent: async (_sessionId, event) => {
    const withSeq = { seq: appendedEvents.length + 1, ...event };
    appendedEvents.push(withSeq);
    return withSeq;
  },
  autoCompactMarkerText: 'Older messages above this marker are no longer in the model live context.',
  broadcastSessionInvalidation: () => {},
  buildContextCompactionPrompt: () => '',
  buildFallbackCompactionHandoff: (summary) => `handoff:${summary}`,
  buildToolActivityIndex: () => '',
  clearPersistedResumeIds: async () => false,
  contextCompactorSystemPrompt: 'compact',
  createContextBarrierEvent: (content, extra = {}) => ({
    type: 'context_barrier',
    role: 'system',
    content,
    ...extra,
  }),
  createSession: async () => null,
  enrichSessionMeta: async (meta) => meta,
  ensureLiveSession: () => ({}),
  getAutoCompactContextTokens: () => 0,
  getAutoCompactStatusText: () => '',
  getContextHead: async () => null,
  getHistorySnapshot: async () => ({ latestSeq: 0 }),
  getRunLiveContextTokens: () => 0,
  getSession: async () => ({ id: sessionId }),
  getSessionQueueCount: () => 0,
  internalSessionRoleContextCompactor: 'context_compactor',
  isContextCompactorSession: () => false,
  loadHistory: async () => [{
    type: 'message',
    role: 'assistant',
    runId: run.id,
    content: '<summary>compact summary</summary><handoff>carry this forward</handoff>',
  }],
  loadSessionsMeta: async () => [],
  messageEvent: (role, content, attachments, extra = {}) => ({
    type: 'message',
    role,
    content,
    attachments,
    ...extra,
  }),
  mutateSessionMeta: async () => ({ changed: false, meta: { id: sessionId } }),
  nowIso: () => '2026-04-08T00:00:00.000Z',
  parseCompactionWorkerOutput: () => ({
    summary: 'compact summary',
    handoff: 'carry this forward',
  }),
  prepareConversationOnlyContinuationBody: () => '',
  refreshCodexContextMetrics: async () => null,
  sendMessage: async () => ({ ok: true }),
  setContextHead: async (_sessionId, value) => {
    persistedContextHead = value;
  },
  startupSyncDebug: false,
  statusEvent: (status) => ({ type: 'status', status }),
});

const deps = {
  liveSessions: new Map(),
  SESSION_ORGANIZER_INTERNAL_OPERATION: 'session_organizer',
  nowIso: () => '2026-04-08T00:00:00.000Z',
  sanitizeAssistantRunEvents() {
    return {
      sanitizedEvents: [],
      latestTaskCard: null,
    };
  },
  appendEvents: async () => {},
  appendEvent: async (_sessionId, event) => {
    const withSeq = { seq: appendedEvents.length + 1, ...event };
    appendedEvents.push(withSeq);
    return withSeq;
  },
  statusEvent: (status) => ({ type: 'status', status }),
  mutateSessionMeta: async () => ({ changed: false, meta: { id: sessionId } }),
  updateRun: async () => run,
  findSessionMeta: async () => null,
  stabilizeSessionTaskCard: (_meta, taskCard) => taskCard,
  updateSessionTaskCard: async () => false,
  buildBranchCandidateStatusEvents: () => [],
  findLatestUserMessageSeqForRun: async () => 0,
  finalizeSessionOrganizerRun: async () => ({ changed: false }),
  broadcastSessionInvalidation: () => {},
  getSession: async () => ({ id: sessionId }),
  getSessionQueueCount: () => 0,
  scheduleQueuedFollowUpDispatch: () => {},
  getFollowUpQueueCount: () => 0,
  maybePublishRunResultAssets: async () => false,
  syncSessionContinuityFromSession: async () => {},
  emitHook: async () => ({ executed: [], failures: [] }),
  normalizeSessionTaskCard: (value) => value,
  applyDirectCompactionResult: compactionService.applyDirectCompactionResult,
  maybeAutoCompact: async () => false,
  applyCompactionWorkerResult: async () => false,
};

await finalizeDetachedRunWithDeps(deps, {
  sessionId,
  run,
  manifest: {
    internalOperation: 'context_compaction',
  },
  normalizedEvents: [],
});

assert.equal(appendedEvents.length, 3);
assert.equal(appendedEvents[0].type, 'context_barrier');
assert.equal(appendedEvents[1].type, 'message');
assert.equal(appendedEvents[1].source, 'context_compaction_handoff');
assert.equal(appendedEvents[1].content, 'carry this forward');
assert.equal(appendedEvents[2].type, 'status');
assert.match(appendedEvents[2].status, /continue from the handoff below/);

assert.deepEqual(
  persistedContextHead,
  {
    mode: 'summary',
    summary: '',
    toolIndex: '',
    activeFromSeq: 3,
    compactedThroughSeq: 3,
    inputTokens: 321,
    updatedAt: '2026-04-08T00:00:00.000Z',
    source: 'context_compaction',
    barrierSeq: 1,
    handoffSeq: 2,
    compactionSessionId: sessionId,
  },
);

console.log('test-run-finalization-direct-compaction-handoff: ok');
