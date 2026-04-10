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
const nodeCapabilitiesSource = readWorkbenchFrontendSource('node-capabilities.js');

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
  status: 'active',
};
assert.equal(api.hasNodeCapability(sessionNode, 'open-session'), true);
assert.equal(api.resolvePrimaryAction(sessionNode), 'open-session');
assert.equal(api.isNodeDirectlyInteractive(sessionNode), true);
assert.equal(api.canCreateManualBranch(sessionNode), true);
assert.equal(api.canReparentSession(sessionNode), true);
assert.deepEqual(
  JSON.parse(JSON.stringify(api.buildManualBranchCreationPayload(sessionNode))),
  {
    branchReason: '从「视觉风格线」继续展开关联任务',
    checkpointSummary: '视觉风格线',
  },
  'session-backed current nodes should expose a dedicated manual branch payload builder',
);
assert.equal(
  api.canCreateManualBranch({ ...sessionNode, status: 'merged' }),
  false,
  'resolved or merged nodes should not expose manual branch creation actions',
);

const controllerCalls = [];
const attachedSessions = [];
const reparentCalls = [];
const connectCalls = [];
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
  async reparentSession(sourceSessionId, payload) {
    reparentCalls.push({ sourceSessionId, payload });
  },
  async connectSessions(sourceSessionId, payload) {
    connectCalls.push({ sourceSessionId, payload });
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
        branchReason: '从「主任务」继续展开关联任务',
        checkpointSummary: '补充复盘',
      },
    },
  ],
  'capability controller should translate candidate node actions into branch creation calls',
);

controllerCalls.length = 0;
await controller.executeManualBranch(sessionNode, '补充配色规范');
assert.deepEqual(
  JSON.parse(JSON.stringify(controllerCalls)),
  [
    'collapse',
    {
      type: 'create-branch',
      sessionId: 'branch-1',
      title: '补充配色规范',
      payload: {
        branchReason: '从「视觉风格线」继续展开关联任务',
        checkpointSummary: '视觉风格线',
      },
    },
  ],
  'manual branch creation should reuse the same branch lifecycle API with the node as the source session',
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

await controller.executeReparentSession(sessionNode, 'main-2', {
  branchReason: '挂到新的主线下面',
});
assert.deepEqual(
  JSON.parse(JSON.stringify(reparentCalls)),
  [
    {
      sourceSessionId: 'branch-1',
      payload: {
        targetSessionId: 'main-2',
        branchReason: '挂到新的主线下面',
      },
    },
  ],
  'reparent action should route through the injected reparentSession handler',
);

assert.equal(api.canConnectSession(sessionNode), true);
await controller.executeConnectSession(sessionNode, 'main-2', {
  graphEdgeType: 'related',
});
assert.deepEqual(
  JSON.parse(JSON.stringify(connectCalls)),
  [
    {
      sourceSessionId: 'branch-1',
      payload: {
        targetSessionId: 'main-2',
        graphEdgeType: 'related',
      },
    },
  ],
  'connect action should route through the injected connectSessions handler',
);

console.log('test-workbench-node-capabilities: ok');
