#!/usr/bin/env node
import assert from 'assert/strict';
import { createBranchCandidatesHook } from '../chat/hooks/branch-candidates-hook.mjs';

const appended = [];
const synced = [];

const hook = createBranchCandidatesHook({
  appendEvents: async (sessionId, events) => {
    appended.push({ sessionId, events });
  },
  syncBranchCandidateTaskMapPlan: async (context) => {
    synced.push(context);
  },
});

await hook({
  sessionId: 'session-main',
  session: { id: 'session-main' },
  taskCard: { candidateBranches: ['补充复盘'] },
  branchCandidateEvents: [
    {
      type: 'status',
      status: '建议拆出支线：补充复盘',
      branchTitle: '补充复盘',
    },
  ],
});

assert.equal(appended.length, 1, 'branch-candidates hook should still append lifecycle events to history');
assert.equal(appended[0].sessionId, 'session-main');
assert.equal(appended[0].events.length, 1);
assert.equal(synced.length, 1, 'branch-candidates hook should sync task-map plans after appending events');
assert.equal(synced[0].sessionId, 'session-main');

await hook({
  sessionId: 'session-main',
  session: { id: 'session-main' },
  taskCard: { candidateBranches: [] },
  branchCandidateEvents: [],
});

assert.equal(appended.length, 1, 'branch-candidates hook should ignore empty candidate batches');
assert.equal(synced.length, 1, 'branch-candidates hook should not sync plans for empty candidate batches');

console.log('test-branch-candidates-hook: ok');
