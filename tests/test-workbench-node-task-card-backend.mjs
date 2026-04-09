#!/usr/bin/env node
import assert from 'assert/strict';
import {
  buildTaskCardPatch,
  buildTaskCardPatchEntries,
  buildTaskCardPatchForSourceSession,
} from '../backend/workbench/node-task-card.mjs';

const nodes = [
  {
    id: 'goal:main-1',
    kind: 'main',
    title: '收拢 node contract',
    summary: '让 hooks 和地图继续围绕 node instance 演进',
    sourceSessionId: 'main-1',
    taskCardBindings: ['mainGoal', 'summary'],
  },
  {
    id: 'candidate:main-1:review',
    kind: 'candidate',
    title: '补充复盘',
    summary: '建议拆分',
    sourceSessionId: 'main-1',
  },
  {
    id: 'next:main-1',
    kind: 'done',
    title: '整理对外文档',
    sourceSessionId: 'main-1',
    taskCardBindings: ['nextSteps'],
  },
];

assert.deepEqual(
  buildTaskCardPatchEntries(nodes),
  [
    {
      nodeId: 'goal:main-1',
      sourceSessionId: 'main-1',
      bindingKey: 'mainGoal',
      value: '收拢 node contract',
      origin: null,
    },
    {
      nodeId: 'goal:main-1',
      sourceSessionId: 'main-1',
      bindingKey: 'summary',
      value: '让 hooks 和地图继续围绕 node instance 演进',
      origin: null,
    },
    {
      nodeId: 'candidate:main-1:review',
      sourceSessionId: 'main-1',
      bindingKey: 'candidateBranches',
      value: '补充复盘',
      origin: null,
    },
    {
      nodeId: 'next:main-1',
      sourceSessionId: 'main-1',
      bindingKey: 'nextSteps',
      value: '整理对外文档',
      origin: null,
    },
  ],
  'backend node task-card helper should expose stable binding entries for graph nodes',
);

assert.deepEqual(
  buildTaskCardPatch(nodes),
  {
    mainGoal: '收拢 node contract',
    summary: '让 hooks 和地图继续围绕 node instance 演进',
    candidateBranches: ['补充复盘'],
    nextSteps: ['整理对外文档'],
  },
  'backend node task-card helper should fold scalar and array bindings into a deterministic patch',
);

assert.deepEqual(
  buildTaskCardPatchForSourceSession(nodes, 'main-1'),
  {
    mainGoal: '收拢 node contract',
    summary: '让 hooks 和地图继续围绕 node instance 演进',
    candidateBranches: ['补充复盘'],
    nextSteps: ['整理对外文档'],
  },
  'backend node task-card helper should support session-scoped patch derivation',
);

assert.deepEqual(
  buildTaskCardPatch([
    {
      id: 'session:main-1',
      kind: 'main',
      title: '默认主任务',
      sourceSessionId: 'main-1',
      taskCardBindings: ['mainGoal'],
      origin: { type: 'projection', sourceId: 'continuity' },
    },
    {
      id: 'goal:main-1',
      kind: 'main',
      title: '计划里指定的目标',
      sourceSessionId: 'main-1',
      taskCardBindings: ['mainGoal'],
      origin: { type: 'plan', planId: 'manual-plan:main-1' },
    },
  ]),
  {
    mainGoal: '计划里指定的目标',
  },
  'backend node task-card helper should let plan-backed nodes override projection-backed scalar bindings',
);

console.log('test-workbench-node-task-card-backend: ok');
