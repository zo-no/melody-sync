#!/usr/bin/env node
import assert from 'assert/strict';
import {
  buildSessionTaskCardFromTaskMapPlans,
  syncSessionTaskCardFromTaskMapPlans,
} from '../backend/workbench/node-task-card-sync.mjs';

const session = {
  id: 'main-1',
  rootSessionId: 'main-1',
  taskCard: {
    goal: '整理 node 架构',
    mainGoal: '默认主任务',
    summary: '默认摘要',
    candidateBranches: ['旧候选'],
  },
};

const taskMapPlans = [
  {
    id: 'hook-plan:branch-candidates:main-1',
    rootSessionId: 'main-1',
    nodes: [
      {
        id: 'candidate:main-1:review-topic',
        kind: 'candidate',
        title: '复盘专题',
        sourceSessionId: 'main-1',
        parentNodeId: 'session:main-1',
        origin: {
          type: 'hook',
          hookId: 'builtin.branch-candidates',
          sourceId: 'builtin.branch-candidates',
        },
      },
    ],
  },
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
        origin: {
          type: 'manual',
          planId: 'manual-plan:main-1:goal',
          sourceId: 'manual-plan:main-1:goal',
        },
      },
    ],
  },
];

assert.deepEqual(
  buildSessionTaskCardFromTaskMapPlans({
    session,
    taskMapPlans,
    managedBindingKeys: ['candidateBranches', 'mainGoal', 'summary'],
  }),
  {
    version: 1,
    mode: 'task',
    summary: '让自定义目标节点和内建支线建议并存',
    goal: '整理 node 架构',
    mainGoal: '构建 node 驱动页面表达',
    lineRole: 'main',
    branchFrom: '',
    branchReason: '',
    checkpoint: '',
    candidateBranches: ['复盘专题'],
    background: [],
    rawMaterials: [],
    assumptions: [],
    knownConclusions: [],
    nextSteps: [],
    memory: [],
    needsFromUser: [],
  },
  'node task-card sync should merge builtin candidate plans and custom manual plans into one normalized session card',
);

let captured = null;
const updated = await syncSessionTaskCardFromTaskMapPlans({
  session,
  taskMapPlans: [],
  managedBindingKeys: ['candidateBranches'],
  async updateSessionTaskCard(sessionId, nextTaskCard) {
    captured = { sessionId, nextTaskCard };
    return { ...session, taskCard: nextTaskCard };
  },
});

assert.equal(captured.sessionId, 'main-1');
assert.deepEqual(
  captured.nextTaskCard.candidateBranches,
  [],
  'node task-card sync should clear managed array bindings when no matching task-map nodes remain',
);
assert.equal(
  updated.taskCard.mainGoal,
  '默认主任务',
  'node task-card sync should keep unrelated scalar bindings when only candidate branches are being managed',
);

console.log('test-workbench-node-task-card-sync: ok');
