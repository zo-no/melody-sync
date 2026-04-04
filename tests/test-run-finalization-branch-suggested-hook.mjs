#!/usr/bin/env node
import assert from 'assert/strict';
import { finalizeDetachedRunWithDeps } from '../backend/run-finalization.mjs';

const sessionId = 'sess_branch_suggested';
const finalizedRun = {
  id: 'run_branch_suggested',
  sessionId,
  state: 'completed',
  requestId: 'req_branch_suggested',
};

const emittedEvents = [];

const deps = {
  liveSessions: new Map(),
  SESSION_ORGANIZER_INTERNAL_OPERATION: 'session_organizer',
  nowIso: () => '2026-04-03T00:00:00.000Z',
  sanitizeAssistantRunEvents() {
    return {
      sanitizedEvents: [{ type: 'message', role: 'assistant', content: 'done' }],
      latestTaskCard: {
        goal: '梳理电影史主线',
        candidateBranches: ['单独整理 12 周片单'],
        branchReason: '片单需要多轮整理，继续留在主线会污染当前上下文。',
      },
    };
  },
  appendEvents: async () => {},
  appendEvent: async () => {},
  statusEvent: (status) => ({ type: 'status', status }),
  findLatestAssistantMessageForRun: async () => null,
  extractTaggedBlock: () => '',
  setContextHead: async () => {},
  clearPersistedResumeIds: async () => false,
  mutateSessionMeta: async () => ({ changed: false, meta: { id: sessionId, taskCard: null } }),
  updateRun: async () => ({ ...finalizedRun, finalizedAt: '2026-04-03T00:00:00.000Z' }),
  findSessionMeta: async () => null,
  stabilizeSessionTaskCard: (_meta, taskCard) => taskCard,
  updateSessionTaskCard: async () => true,
  buildBranchCandidateStatusEvents: () => ([
    {
      type: 'status',
      status: '建议拆出支线：单独整理 12 周片单',
      statusKind: 'branch_candidate',
      branchTitle: '单独整理 12 周片单',
    },
  ]),
  findLatestUserMessageSeqForRun: async () => 7,
  finalizeSessionOrganizerRun: async () => ({ changed: false }),
  broadcastSessionInvalidation: () => {},
  getSession: async () => ({ id: sessionId, taskCard: {} }),
  getSessionQueueCount: () => 0,
  scheduleQueuedFollowUpDispatch: () => {},
  getFollowUpQueueCount: () => 0,
  maybePublishRunResultAssets: async () => false,
  syncSessionContinuityFromSession: async () => {},
  emitHook: async (event, ctx) => {
    emittedEvents.push({
      event,
      branchCandidateEvents: Array.isArray(ctx?.branchCandidateEvents) ? ctx.branchCandidateEvents.length : 0,
    });
  },
  normalizeSessionTaskCard: (value) => value,
  maybeAutoCompact: async () => false,
  applyCompactionWorkerResult: async () => false,
};

await finalizeDetachedRunWithDeps(deps, {
  sessionId,
  run: finalizedRun,
  manifest: null,
  normalizedEvents: [{ type: 'message', role: 'assistant', content: 'done' }],
});

assert.deepEqual(
  emittedEvents,
  [
    { event: 'branch.suggested', branchCandidateEvents: 1 },
    { event: 'run.completed', branchCandidateEvents: 1 },
  ],
  'run finalization should emit branch.suggested before the broader run.completed hook',
);

console.log('test-run-finalization-branch-suggested-hook: ok');
