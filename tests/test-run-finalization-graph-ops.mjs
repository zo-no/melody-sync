#!/usr/bin/env node
import assert from 'assert/strict';
import { finalizeDetachedRunWithDeps } from '../backend/run/finalization.mjs';

const sessionId = 'sess_graph_ops';
const finalizedRun = {
  id: 'run_graph_ops',
  sessionId,
  state: 'completed',
  requestId: 'req_graph_ops',
};

const log = [];
const hookPayloads = [];

const deps = {
  liveSessions: new Map(),
  SESSION_ORGANIZER_INTERNAL_OPERATION: 'session_organizer',
  nowIso: () => '2026-04-09T00:00:00.000Z',
  sanitizeAssistantRunEvents() {
    return {
      sanitizedEvents: [{ type: 'message', role: 'assistant', content: 'done' }],
      latestTaskCard: {
        goal: '整理任务图',
        checkpoint: '去重并调整挂载',
      },
      latestGraphOps: {
        version: 1,
        operations: [
          {
            type: 'attach',
            source: { ref: '重复任务' },
            target: { ref: '主线任务' },
            reason: '归到更合适的父任务下',
          },
        ],
      },
    };
  },
  appendEvents: async () => {
    log.push('appendEvents');
  },
  appendEvent: async () => {
    log.push('appendEvent');
  },
  statusEvent: (status) => ({ type: 'status', status }),
  findLatestAssistantMessageForRun: async () => null,
  createContextBarrierEvent: () => ({ type: 'context_barrier' }),
  buildFallbackCompactionHandoff: () => '',
  messageEvent: (role, content) => ({ type: 'message', role, content }),
  parseCompactionWorkerOutput: () => ({}),
  setContextHead: async () => {},
  clearPersistedResumeIds: async () => false,
  mutateSessionMeta: async () => ({ changed: false, meta: { id: sessionId, taskCard: null } }),
  updateRun: async () => ({ ...finalizedRun, finalizedAt: '2026-04-09T00:00:00.000Z' }),
  findSessionMeta: async () => ({ id: sessionId, taskCard: { goal: '整理任务图', checkpoint: '去重并调整挂载' } }),
  stabilizeSessionTaskCard: (_meta, taskCard) => taskCard,
  updateSessionTaskCard: async () => {
    log.push('updateTaskCard');
    return { id: sessionId, taskCard: { goal: '整理任务图', checkpoint: '去重并调整挂载' } };
  },
  buildBranchCandidateStatusEvents: () => [],
  findLatestUserMessageSeqForRun: async () => 5,
  finalizeSessionOrganizerRun: async () => ({ changed: false }),
  broadcastSessionInvalidation: () => {},
  getSession: async () => ({ id: sessionId, taskCard: { goal: '整理任务图' } }),
  getSessionQueueCount: () => 0,
  scheduleQueuedFollowUpDispatch: () => {},
  getFollowUpQueueCount: () => 0,
  maybePublishRunResultAssets: async () => false,
  syncSessionContinuityFromSession: async () => {
    log.push('syncContinuity');
  },
  emitHook: async (event, context) => {
    log.push(`hook:${event}`);
    hookPayloads.push({
      event,
      graphOps: context?.graphOps || null,
      appliedCount: context?.graphOpResult?.appliedCount || 0,
    });
  },
  normalizeSessionTaskCard: (value) => value,
  maybeAutoCompact: async () => false,
  applyCompactionWorkerResult: async () => false,
};

const result = await finalizeDetachedRunWithDeps(deps, {
  sessionId,
  run: finalizedRun,
  manifest: null,
  normalizedEvents: [{ type: 'message', role: 'assistant', content: 'done' }],
});

assert.deepEqual(result, { historyChanged: true, sessionChanged: true });
assert.ok(
  log.indexOf('updateTaskCard') < log.indexOf('syncContinuity'),
  'graph ops proposals should no longer auto-apply during finalization; only task-card persistence should precede continuity sync',
);
assert.deepEqual(
  hookPayloads,
  [
    {
      event: 'run.completed',
      graphOps: {
        version: 1,
        operations: [
          {
            type: 'attach',
            source: { ref: '重复任务' },
            target: { ref: '主线任务' },
            reason: '归到更合适的父任务下',
          },
        ],
      },
      appliedCount: 0,
    },
  ],
  'run hooks should receive parsed graph ops proposals, but user click should be required before any apply result exists',
);

console.log('test-run-finalization-graph-ops: ok');
