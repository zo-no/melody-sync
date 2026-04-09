#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

function readWorkbenchFrontendSource(filename) {
  const candidates = [
    join(repoRoot, 'frontend-src', 'workbench', filename),
    join(repoRoot, 'static', 'frontend', 'workbench', filename),
  ];
  const targetPath = candidates.find((candidate) => existsSync(candidate));
  if (!targetPath) {
    throw new Error(`Workbench frontend source not found for ${filename}`);
  }
  return readFileSync(targetPath, 'utf8');
}

const nodeContractSource = readWorkbenchFrontendSource('node-contract.js');
const nodeEffectsSource = readWorkbenchFrontendSource('node-effects.js');
const nodeInstanceSource = readWorkbenchFrontendSource('node-instance.js');
const nodeTaskCardSource = readWorkbenchFrontendSource('node-task-card.js');

const context = { console };
context.globalThis = context;
context.window = context;

vm.runInNewContext(nodeContractSource, context, { filename: 'workbench/node-contract.js' });
vm.runInNewContext(nodeEffectsSource, context, { filename: 'workbench/node-effects.js' });
vm.runInNewContext(nodeInstanceSource, context, { filename: 'workbench/node-instance.js' });
vm.runInNewContext(nodeTaskCardSource, context, { filename: 'workbench/node-task-card.js' });

const api = context.MelodySyncWorkbenchNodeTaskCard;
assert.ok(api, 'node task-card api should be exposed on globalThis');
assert.equal(typeof api.buildTaskCardPatchEntries, 'function');
assert.equal(typeof api.buildTaskCardPatch, 'function');

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
  JSON.parse(JSON.stringify(api.buildTaskCardPatchEntries(nodes))),
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
  'node task-card helper should expose stable binding entries for graph nodes',
);

assert.deepEqual(
  JSON.parse(JSON.stringify(api.buildTaskCardPatch(nodes))),
  {
    mainGoal: '收拢 node contract',
    summary: '让 hooks 和地图继续围绕 node instance 演进',
    candidateBranches: ['补充复盘'],
    nextSteps: ['整理对外文档'],
  },
  'node task-card helper should fold scalar and array bindings into a deterministic patch',
);

assert.deepEqual(
  JSON.parse(JSON.stringify(api.buildTaskCardPatchForSourceSession(nodes, 'main-1'))),
  {
    mainGoal: '收拢 node contract',
    summary: '让 hooks 和地图继续围绕 node instance 演进',
    candidateBranches: ['补充复盘'],
    nextSteps: ['整理对外文档'],
  },
  'node task-card helper should support session-scoped patch derivation for the attached session',
);

assert.deepEqual(
  JSON.parse(JSON.stringify(api.buildTaskCardPatch([
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
  ]))),
  {
    mainGoal: '计划里指定的目标',
  },
  'node task-card helper should let plan-backed nodes override projection-backed scalar bindings',
);

console.log('test-workbench-node-task-card: ok');
