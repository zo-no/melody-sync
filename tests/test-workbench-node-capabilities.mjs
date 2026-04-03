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
const nodeCapabilitiesSource = readFileSync(
  join(repoRoot, 'static', 'chat', 'workbench', 'node-capabilities.js'),
  'utf8',
);

const context = { console };
context.globalThis = context;
context.window = context;

vm.runInNewContext(nodeContractSource, context, { filename: 'workbench/node-contract.js' });
vm.runInNewContext(nodeEffectsSource, context, { filename: 'workbench/node-effects.js' });
vm.runInNewContext(nodeInstanceSource, context, { filename: 'workbench/node-instance.js' });
vm.runInNewContext(nodeCapabilitiesSource, context, { filename: 'workbench/node-capabilities.js' });

const api = context.MelodySyncWorkbenchNodeCapabilities;
assert.ok(api, 'node capabilities api should be exposed on globalThis');
assert.equal(typeof api.createController, 'function');

const candidateNode = {
  id: 'candidate:main-1:review',
  kind: 'candidate',
  title: '补充复盘',
  sourceSessionId: 'main-1',
  parentNodeId: 'session:main-1',
};
assert.equal(api.hasNodeCapability(candidateNode, 'create-branch'), true);
assert.equal(api.resolvePrimaryAction(candidateNode), 'create-branch');

const sessionNode = {
  id: 'session:branch-1',
  kind: 'branch',
  title: '视觉风格线',
  sessionId: 'branch-1',
};
assert.equal(api.hasNodeCapability(sessionNode, 'open-session'), true);
assert.equal(api.resolvePrimaryAction(sessionNode), 'open-session');
assert.equal(api.isNodeDirectlyInteractive(sessionNode), true);

const controllerCalls = [];
const attachedSessions = [];
const controller = api.createController({
  collapseTaskMapAfterAction() {
    controllerCalls.push('collapse');
  },
  async enterBranchFromSession(sessionId, title, payload) {
    controllerCalls.push({ type: 'create-branch', sessionId, title, payload });
  },
  getSessionRecord(sessionId) {
    return { id: sessionId, name: '已存在支线' };
  },
  attachSession(sessionId, sessionRecord) {
    attachedSessions.push({ sessionId, sessionRecord });
  },
});

await controller.executePrimaryAction(candidateNode, {
  nodeMap: new Map([
    ['session:main-1', { id: 'session:main-1', title: '主任务' }],
  ]),
});
assert.deepEqual(
  JSON.parse(JSON.stringify(controllerCalls)),
  [
    'collapse',
    {
      type: 'create-branch',
      sessionId: 'main-1',
      title: '补充复盘',
      payload: {
        branchReason: '从「主任务」继续拆出独立支线',
        checkpointSummary: '补充复盘',
      },
    },
  ],
  'capability controller should translate candidate node actions into branch creation calls',
);

controllerCalls.length = 0;
await controller.executePrimaryAction(sessionNode);
assert.deepEqual(
  JSON.parse(JSON.stringify(controllerCalls)),
  ['collapse'],
  'opening a session-backed node should still collapse the task-map drawer first',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(attachedSessions)),
  [
    {
      sessionId: 'branch-1',
      sessionRecord: { id: 'branch-1', name: '已存在支线' },
    },
  ],
  'capability controller should route open-session nodes through attachSession',
);

console.log('test-workbench-node-capabilities: ok');
