#!/usr/bin/env node
import assert from 'assert/strict';
import {
  collectManagedBindingKeysForRootSession,
  listAffectedRootSessionIds,
  persistTaskMapPlansWithSessionSync,
  syncSessionTaskCardsForTaskMapPlans,
} from '../backend/workbench/task-map-plan-sync.mjs';

const previousTaskMapPlans = [
  {
    id: 'hook-plan:branch-candidates:main-1',
    rootSessionId: 'main-1',
    nodes: [
      {
        id: 'candidate:main-1:review-topic',
        kind: 'candidate',
        title: '复盘专题',
        sourceSessionId: 'main-1',
        taskCardBindings: ['candidateBranches'],
      },
    ],
  },
];

const nextTaskMapPlans = [
  {
    id: 'manual-plan:main-1:goal',
    rootSessionId: 'main-1',
    nodes: [
      {
        id: 'goal-panel:main-1',
        kind: 'main',
        title: '构建 node 驱动页面表达',
        summary: '让自定义目标节点和内建支线建议并存',
        sourceSessionId: 'main-1',
        taskCardBindings: ['mainGoal', 'summary'],
        origin: { type: 'manual', sourceId: 'manual-plan:main-1:goal' },
      },
    ],
  },
];

assert.deepEqual(
  listAffectedRootSessionIds(previousTaskMapPlans, nextTaskMapPlans),
  ['main-1'],
  'task-map-plan sync should track affected roots across removed and added plans',
);

assert.deepEqual(
  collectManagedBindingKeysForRootSession(
    [...previousTaskMapPlans, ...nextTaskMapPlans],
    'main-1',
  ),
  ['candidateBranches', 'mainGoal', 'summary'],
  'task-map-plan sync should collect managed task-card bindings from all plans attached to the same root',
);

const sessions = [
  {
    id: 'main-1',
    rootSessionId: 'main-1',
    taskCard: {
      goal: '整理 node 架构',
      mainGoal: '默认主任务',
      summary: '默认摘要',
      candidateBranches: ['旧候选'],
    },
  },
  {
    id: 'branch-1',
    rootSessionId: 'main-1',
    sourceContext: { parentSessionId: 'main-1' },
    taskCard: {
      goal: '支线目标',
      candidateBranches: ['旧支线候选'],
    },
  },
];

const updates = [];
await syncSessionTaskCardsForTaskMapPlans({
  previousTaskMapPlans,
  nextTaskMapPlans,
  sessions,
  async updateSessionTaskCard(sessionId, nextTaskCard) {
    updates.push({ sessionId, nextTaskCard });
    const session = sessions.find((entry) => entry.id === sessionId);
    return { ...session, taskCard: nextTaskCard };
  },
});

assert.deepEqual(
  updates,
  [
    {
      sessionId: 'main-1',
      nextTaskCard: {
        version: 1,
        mode: 'task',
        summary: '让自定义目标节点和内建支线建议并存',
        goal: '整理 node 架构',
        mainGoal: '构建 node 驱动页面表达',
        lineRole: 'main',
        branchFrom: '',
        branchReason: '',
        checkpoint: '',
        candidateBranches: [],
        background: [],
        rawMaterials: [],
        assumptions: [],
        knownConclusions: [],
        nextSteps: [],
        memory: [],
        needsFromUser: [],
      },
    },
    {
      sessionId: 'branch-1',
      nextTaskCard: {
        version: 1,
        mode: 'task',
        summary: '',
        goal: '支线目标',
        mainGoal: '支线目标',
        lineRole: 'main',
        branchFrom: '',
        branchReason: '',
        checkpoint: '',
        candidateBranches: [],
        background: [],
        rawMaterials: [],
        assumptions: [],
        knownConclusions: [],
        nextSteps: [],
        memory: [],
        needsFromUser: [],
      },
    },
  ],
  'task-map-plan sync should update every session under the affected root and clear removed candidate arrays while preserving new scalar plan bindings',
);

const persisted = await persistTaskMapPlansWithSessionSync({
  plans: nextTaskMapPlans,
  sessions,
  async updateSessionTaskCard(sessionId, nextTaskCard) {
    return { sessionId, taskCard: nextTaskCard };
  },
});
assert.deepEqual(
  persisted.nextTaskMapPlans.map((plan) => plan.id),
  ['manual-plan:main-1:goal'],
  'task-map-plan sync should persist the normalized plan set before syncing task cards',
);
assert.equal(
  persisted.taskCardUpdates.length,
  2,
  'task-map-plan sync should report updates for each session under the affected root when a persisted plan set manages shared bindings',
);

console.log('test-workbench-task-map-plan-sync: ok');
