#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const nodeContractSource = readFileSync(
  join(repoRoot, 'static', 'chat', 'workbench', 'node-contract.js'),
  'utf8',
);
const nodeEffectsSource = readFileSync(
  join(repoRoot, 'static', 'chat', 'workbench', 'node-effects.js'),
  'utf8',
);
const nodeInstanceSource = readFileSync(
  join(repoRoot, 'static', 'chat', 'workbench', 'node-instance.js'),
  'utf8',
);

const context = { console };
context.globalThis = context;
context.window = context;

vm.runInNewContext(nodeContractSource, context, { filename: 'workbench/node-contract.js' });
vm.runInNewContext(nodeEffectsSource, context, { filename: 'workbench/node-effects.js' });
vm.runInNewContext(nodeInstanceSource, context, { filename: 'workbench/node-instance.js' });

const api = context.MelodySyncWorkbenchNodeInstance;
assert.ok(api, 'node instance api should be exposed on globalThis');
assert.equal(typeof api.createNodeInstance, 'function');
assert.equal(typeof api.mergeNodeInstances, 'function');

const candidateNode = api.createNodeInstance({
  id: 'candidate:main-1:review',
  kind: 'candidate',
  title: '补充复盘',
  sourceSessionId: 'main-1',
  parentNodeId: 'session:main-1',
  status: 'candidate',
}, {
  questId: 'quest:main-1',
  origin: { type: 'plan', planId: 'plan:main-1', sourceId: 'hook:builtin.branch-candidates' },
});

assert.equal(candidateNode.questId, 'quest:main-1');
assert.deepEqual(
  JSON.parse(JSON.stringify(candidateNode.capabilities)),
  ['create-branch', 'dismiss'],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(candidateNode.surfaceBindings)),
  ['task-map', 'composer-suggestions'],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(candidateNode.taskCardBindings)),
  ['candidateBranches'],
);
assert.equal(candidateNode.origin?.type, 'plan');
assert.equal(candidateNode.origin?.planId, 'plan:main-1');

const mergedNode = api.mergeNodeInstances(candidateNode, {
  summary: '建议拆成独立支线',
  taskCardBindings: ['candidateBranches', 'summary'],
  view: {
    type: 'markdown',
    content: '## 复盘建议',
    width: 420,
    height: 280,
  },
});

assert.equal(mergedNode.summary, '建议拆成独立支线');
assert.deepEqual(
  JSON.parse(JSON.stringify(mergedNode.taskCardBindings)),
  ['candidateBranches', 'summary'],
);
assert.equal(mergedNode.view?.type, 'markdown');
assert.equal(api.hasSurfaceBinding(mergedNode, 'composer-suggestions'), true);

assert.deepEqual(
  JSON.parse(JSON.stringify(api.buildComposerSuggestionEntry(mergedNode))),
  {
    id: 'candidate:main-1:review',
    text: '补充复盘',
    summary: '建议拆成独立支线',
    capabilities: ['create-branch', 'dismiss'],
    sourceSessionId: 'main-1',
    taskCardBindings: ['candidateBranches', 'summary'],
    origin: {
      type: 'plan',
      sourceId: 'hook:builtin.branch-candidates',
      sourceLabel: '',
      hookId: '',
      planId: 'plan:main-1',
    },
  },
  'node instance module should expose stable surface-ready entries for other UI slots',
);

console.log('test-workbench-node-instance: ok');
