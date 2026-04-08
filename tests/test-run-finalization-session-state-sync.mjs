#!/usr/bin/env node
import assert from 'assert/strict';
import { finalizeDetachedRunWithDeps } from '../backend/run/finalization.mjs';

const sessionId = 'sess_state_sync';
const finalizedRun = {
  id: 'run_state_sync',
  sessionId,
  state: 'completed',
  requestId: 'req_state_sync',
  result: {
    reply: '已完成',
    statePatch: {
      goal: '不应覆盖 taskCard 派生状态',
    },
  },
};

const meta = {
  id: sessionId,
  taskCard: null,
};

const deps = {
  liveSessions: new Map(),
  SESSION_ORGANIZER_INTERNAL_OPERATION: 'session_organizer',
  nowIso: () => '2026-04-08T00:00:00.000Z',
  sanitizeAssistantRunEvents() {
    return {
      sanitizedEvents: [{ type: 'message', role: 'assistant', content: 'done' }],
      latestTaskCard: {
        goal: '梳理会话流程',
        mainGoal: '梳理会话流程',
        checkpoint: '下一步接入 session-manager',
        lineRole: 'main',
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
  mutateSessionMeta: async (_sessionId, updater) => {
    const draft = JSON.parse(JSON.stringify(meta));
    const changed = updater(draft);
    if (changed) {
      Object.assign(meta, draft);
    }
    return { changed, meta: { ...meta } };
  },
  updateRun: async () => ({ ...finalizedRun, finalizedAt: '2026-04-08T00:00:00.000Z' }),
  findSessionMeta: async () => ({ ...meta }),
  stabilizeSessionTaskCard: (_currentMeta, taskCard) => taskCard,
  updateSessionTaskCard: async () => true,
  buildBranchCandidateStatusEvents: () => [],
  findLatestUserMessageSeqForRun: async () => 3,
  finalizeSessionOrganizerRun: async () => ({ changed: false }),
  broadcastSessionInvalidation: () => {},
  getSession: async () => ({ id: sessionId, taskCard: meta.taskCard, sessionState: meta.sessionState }),
  getSessionQueueCount: () => 0,
  scheduleQueuedFollowUpDispatch: () => {},
  getFollowUpQueueCount: () => 0,
  maybePublishRunResultAssets: async () => false,
  syncSessionContinuityFromSession: async () => {},
  emitHook: async () => ({ executed: [], failures: [] }),
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
  meta.sessionState,
  {
    goal: '梳理会话流程',
    mainGoal: '梳理会话流程',
    checkpoint: '下一步接入 session-manager',
    needsUser: false,
    lineRole: 'main',
    branchFrom: '',
  },
  'run finalization should persist a normalized sessionState projection derived from the stabilized task card',
);

console.log('test-run-finalization-session-state-sync: ok');
