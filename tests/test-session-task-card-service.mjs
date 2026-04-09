#!/usr/bin/env node
import assert from 'assert/strict';
import { createSessionTaskCardService } from '../backend/services/session/task-card-service.mjs';
import { normalizeSessionTaskCard } from '../backend/session/task-card.mjs';

function normalizeSuppressedBranchTitles(value) {
  const rawItems = Array.isArray(value)
    ? value
    : (typeof value === 'string' && value.trim() ? value.split(/\n+/) : []);
  const next = [];
  const seen = new Set();
  for (const raw of rawItems) {
    const normalized = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(normalized);
  }
  return next;
}

const service = createSessionTaskCardService({
  loadHistory: async () => ([
    { type: 'message', role: 'user', seq: 2, runId: 'run_other', requestId: 'req_other' },
    { type: 'message', role: 'assistant', seq: 3, runId: 'run_target' },
    { type: 'message', role: 'user', seq: 4, runId: 'run_target', requestId: 'req_target' },
  ]),
  normalizeSessionTaskCard,
  normalizeSuppressedBranchTitles,
  statusEvent: (content, extra = {}) => ({
    type: 'status',
    content,
    ...extra,
  }),
  trimString: (value) => String(value || '').trim(),
});

const mainTaskCard = service.stabilizeSessionTaskCard({
  name: '整理主线',
}, {
  goal: '整理主线',
  candidateBranches: ['补充片单'],
}, {
  managedBindingKeys: ['candidateBranches'],
});

assert.equal(mainTaskCard?.goal, '整理主线');
assert.equal(mainTaskCard?.mainGoal, '整理主线');
assert.equal(mainTaskCard?.lineRole, 'main');
assert.equal(mainTaskCard?.branchFrom, '');
assert.equal(mainTaskCard?.branchReason, '');
assert.deepEqual(
  mainTaskCard?.candidateBranches || [],
  ['补充片单'],
  'main-line task cards should preserve managed candidate branches while remaining on the main line',
);

const branchTaskCard = service.stabilizeSessionTaskCard({
  name: '预算支线',
  taskCard: {
    goal: '拆分预算',
    mainGoal: '年度理财',
    lineRole: 'branch',
    branchFrom: '年度理财',
  },
  sourceContext: {
    parentSessionId: 'sess_parent',
  },
}, {
  goal: '拆分预算',
  mainGoal: '年度理财',
});

assert.equal(branchTaskCard?.lineRole, 'branch');
assert.equal(branchTaskCard?.mainGoal, '年度理财');
assert.equal(branchTaskCard?.branchFrom, '年度理财');

const branchCandidateEvents = service.buildBranchCandidateStatusEvents({
  id: 'run_target',
  requestId: 'req_target',
}, {
  sourceSeq: 4,
  previousTaskCard: {
    candidateBranches: ['旧支线'],
  },
  nextTaskCard: {
    goal: '整理主线',
    mainGoal: '整理主线',
    candidateBranches: ['旧支线', '新支线'],
    branchReason: '新支线更适合单独推进。',
  },
  suppressedBranchTitles: ['忽略支线'],
});

assert.deepEqual(
  branchCandidateEvents,
  [
    {
      type: 'status',
      content: '建议拆出支线：新支线',
      statusKind: 'branch_candidate',
      branchTitle: '新支线',
      branchReason: '新支线更适合单独推进。',
      autoSuggested: true,
      intentShift: true,
      independentGoal: true,
      sourceSeq: 4,
      runId: 'run_target',
      requestId: 'req_target',
    },
  ],
  'branch candidate closeout should only emit newly introduced unsuppressed candidates',
);

assert.equal(
  await service.findLatestUserMessageSeqForRun('sess_target', {
    id: 'run_target',
    requestId: 'req_target',
  }),
  4,
  'task-card closeout should anchor branch-candidate events to the latest matching user message sequence',
);

console.log('test-session-task-card-service: ok');
