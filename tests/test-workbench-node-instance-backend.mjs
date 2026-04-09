#!/usr/bin/env node
import assert from 'assert/strict';
import {
  createNodeInstance,
  mergeNodeInstances,
} from '../backend/workbench/node-instance.mjs';

const candidateNode = createNodeInstance({
  id: 'candidate:main-1:review',
  kind: 'candidate',
  title: '补充复盘',
  sourceSessionId: 'main-1',
  parentNodeId: 'session:main-1',
  status: 'candidate',
}, {
  questId: 'quest:main-1',
  origin: { type: 'plan', planId: 'plan:main-1', sourceId: 'builtin.branch-candidates' },
});

assert.ok(candidateNode, 'backend node-instance helper should materialize known node kinds');
assert.equal(candidateNode.questId, 'quest:main-1');
assert.deepEqual(candidateNode.capabilities, ['create-branch', 'dismiss']);
assert.deepEqual(candidateNode.surfaceBindings, ['task-map', 'composer-suggestions']);
assert.deepEqual(candidateNode.taskCardBindings, ['candidateBranches']);
assert.equal(candidateNode.origin?.type, 'plan');
assert.equal(candidateNode.origin?.planId, 'plan:main-1');

const mergedNode = mergeNodeInstances(candidateNode, {
  summary: '建议拆分',
  taskCardBindings: ['candidateBranches', 'summary'],
  view: {
    type: 'markdown',
    content: '## 复盘建议',
    width: 420,
    height: 280,
  },
});

assert.equal(mergedNode.summary, '建议拆分');
assert.deepEqual(mergedNode.taskCardBindings, ['candidateBranches', 'summary']);
assert.equal(mergedNode.view?.type, 'markdown');
assert.equal(mergedNode.view?.width, 420);

console.log('test-workbench-node-instance-backend: ok');
