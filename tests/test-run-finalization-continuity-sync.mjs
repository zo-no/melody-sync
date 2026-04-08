#!/usr/bin/env node
import assert from 'assert/strict';
import { finalizeDetachedRunWithDeps } from '../backend/run/finalization.mjs';

const sessionId = 'sess_main';
const finalizedRun = {
  id: 'run_123',
  sessionId,
  state: 'completed',
  requestId: 'req_123',
};

const log = [];
const continuityCalls = [];

const deps = {
  liveSessions: new Map(),
  SESSION_ORGANIZER_INTERNAL_OPERATION: 'session_organizer',
  nowIso: () => '2026-04-03T00:00:00.000Z',
  sanitizeAssistantRunEvents() {
    return {
      sanitizedEvents: [{ type: 'message', role: 'assistant', content: 'done' }],
      latestTaskCard: {
        goal: '产出第一版电影史路线',
        checkpoint: '主线已收束成古典→现代→当代',
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
  extractTaggedBlock: () => '',
  setContextHead: async () => {},
  clearPersistedResumeIds: async () => false,
  mutateSessionMeta: async () => ({ changed: false, meta: { id: sessionId, taskCard: null } }),
  updateRun: async () => ({ ...finalizedRun, finalizedAt: '2026-04-03T00:00:00.000Z' }),
  findSessionMeta: async () => null,
  stabilizeSessionTaskCard: (_meta, taskCard) => taskCard,
  updateSessionTaskCard: async () => true,
  buildBranchCandidateStatusEvents: () => [],
  findLatestUserMessageSeqForRun: async () => 11,
  finalizeSessionOrganizerRun: async () => ({ changed: false }),
  broadcastSessionInvalidation: () => {},
  getSession: async () => ({
    id: sessionId,
    taskCard: {
      goal: '旧 goal',
    },
  }),
  getSessionQueueCount: () => 0,
  scheduleQueuedFollowUpDispatch: () => {},
  getFollowUpQueueCount: () => 0,
  maybePublishRunResultAssets: async () => false,
  syncSessionContinuityFromSession: async (session, options = {}) => {
    log.push('syncContinuity');
    continuityCalls.push({ session, options });
  },
  emitHook: async () => {
    log.push('emitHook');
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
assert.equal(continuityCalls.length, 1, 'continuity sync should run exactly once in the main finalization flow');
assert.equal(log.includes('emitHook'), true, 'hooks should still execute after continuity sync');
assert.ok(
  log.indexOf('syncContinuity') < log.indexOf('emitHook'),
  'continuity sync should happen before hooks so map projection does not depend on hook execution',
);
assert.deepEqual(
  continuityCalls[0].options.taskCard,
  {
    goal: '产出第一版电影史路线',
    checkpoint: '主线已收束成古典→现代→当代',
  },
  'continuity sync should receive the stabilized task card from the main flow',
);
assert.deepEqual(
  continuityCalls[0].options.sessionState,
  {
    goal: '产出第一版电影史路线',
    mainGoal: '产出第一版电影史路线',
    checkpoint: '主线已收束成古典→现代→当代',
    needsUser: false,
    lineRole: 'main',
    branchFrom: '',
  },
  'continuity sync should also receive normalized session state so workbench projection can stop depending on taskCard as truth',
);

console.log('test-run-finalization-continuity-sync: ok');
