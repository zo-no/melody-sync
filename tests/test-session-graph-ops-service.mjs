#!/usr/bin/env node
import assert from 'assert/strict';

import { createSessionGraphOpsService } from '../backend/services/session/graph-ops-service.mjs';

const sessions = [
  {
    id: 'sess_root',
    rootSessionId: 'sess_root',
    name: '长期任务主线',
    archived: false,
    sourceContext: {},
  },
  {
    id: 'sess_current',
    rootSessionId: 'sess_root',
    name: '当前任务',
    archived: false,
    sourceContext: {
      parentSessionId: 'sess_root',
    },
  },
];

const createdBranches = [];
const service = createSessionGraphOpsService({
  appendEvent: async () => {},
  createBranchFromSession: async (sessionId, payload = {}) => {
    createdBranches.push({
      sessionId,
      payload,
    });
    return {
      session: {
        id: 'sess_branch_new',
      },
    };
  },
  getSession: async (sessionId) => sessions.find((entry) => entry.id === sessionId) || null,
  listSessions: async () => sessions.slice(),
  setSessionArchived: async () => {},
  statusEvent: (label, extras = {}) => ({
    label,
    ...extras,
  }),
});

const outcome = await service.applySessionGraphOps('sess_current', {
  operations: [
    {
      type: 'expand',
      source: '当前任务',
      title: '补减枝规则',
      checkpoint: '先盘点现有规则',
      reason: '这部分已经适合拆成独立支线',
    },
  ],
});

assert.deepEqual(
  createdBranches,
  [
    {
      sessionId: 'sess_current',
      payload: {
        goal: '补减枝规则',
        branchReason: '这部分已经适合拆成独立支线',
        checkpointSummary: '先盘点现有规则',
      },
    },
  ],
  'expand graph ops should create a real branch session with normalized branch seed payload',
);
assert.equal(outcome.appliedCount, 1);
assert.equal(outcome.historyChanged, true);
assert.equal(outcome.sessionChanged, true);

console.log('test-session-graph-ops-service: ok');
