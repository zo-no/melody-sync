#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const nodeContractSource = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench', 'node-contract.js'),
  'utf8',
);
const nodeEffectsSource = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench', 'node-effects.js'),
  'utf8',
);
const nodeInstanceSource = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench', 'node-instance.js'),
  'utf8',
);
const source = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench', 'graph-model.js'),
  'utf8',
);

const context = { console };
context.globalThis = context;
context.window = context;

vm.runInNewContext(nodeContractSource, context, { filename: 'workbench/node-contract.js' });
vm.runInNewContext(nodeEffectsSource, context, { filename: 'workbench/node-effects.js' });
vm.runInNewContext(nodeInstanceSource, context, { filename: 'workbench/node-instance.js' });
vm.runInNewContext(source, context, { filename: 'workbench/graph-model.js' });

const api = context.MelodySyncWorkbenchGraphModel;
assert.ok(api, 'graph model api should be exposed on globalThis');
assert.equal(typeof api.createQuestGraphCollections, 'function');
assert.equal(typeof api.appendGraphNode, 'function');
assert.equal(typeof api.buildQuestGraphSnapshot, 'function');

const collections = api.createQuestGraphCollections({ questId: 'quest:main-1' });
const rootNode = api.appendGraphNode(collections, {
  id: 'session:main-1',
  kind: 'main',
  title: '主任务',
  sessionId: 'main-1',
  sourceSessionId: 'main-1',
  parentNodeId: null,
  status: 'current',
  lineRole: 'main',
  isCurrent: true,
});
const candidateNode = api.appendGraphNode(collections, {
  id: 'candidate:main-1:review',
  kind: 'candidate',
  title: '补充复盘',
  sourceSessionId: 'main-1',
  parentNodeId: 'session:main-1',
  status: 'candidate',
  lineRole: 'candidate',
});
assert.equal(rootNode.id, 'session:main-1');
assert.equal(candidateNode.parentNodeId, 'session:main-1');
assert.deepEqual(
  JSON.parse(JSON.stringify(collections.nodes.map((node) => node.id))),
  ['session:main-1', 'candidate:main-1:review'],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(collections.edges.map((edge) => ({
    from: edge.fromNodeId,
    to: edge.toNodeId,
    type: edge.type,
  })))),
  [
    {
      from: 'session:main-1',
      to: 'candidate:main-1:review',
      type: 'suggestion',
    },
  ],
  'graph model should synthesize structural graph edges from parent links with node effect semantics',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(rootNode.childNodeIds)),
  ['candidate:main-1:review'],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(rootNode.candidateNodeIds)),
  ['candidate:main-1:review'],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(candidateNode.taskCardBindings)),
  ['candidateBranches'],
);
assert.equal(candidateNode.origin?.type, 'projection');

const snapshot = api.buildQuestGraphSnapshot({
  collections,
  questId: 'quest:main-1',
  rootSessionId: 'main-1',
  title: '当前任务',
  summary: '默认图',
  currentNodeId: 'session:main-1',
});

assert.equal(snapshot.currentNodeId, 'session:main-1');
assert.deepEqual(
  JSON.parse(JSON.stringify(snapshot.nodeIds)),
  ['session:main-1', 'candidate:main-1:review'],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(snapshot.edgeIds)),
  ['edge:session:main-1:candidate:main-1:review'],
);
assert.equal(snapshot.counts.candidateBranches, 1);

const hydratedCollections = api.hydrateQuestGraphCollections({
  questId: 'quest:main-2',
  nodes: [
    {
      id: 'session:main-2',
      kind: 'main',
      title: '第二个任务',
      childNodeIds: [],
      candidateNodeIds: [],
    },
  ],
  edges: [],
});
api.appendGraphNode(hydratedCollections, {
  id: 'done:main-2',
  kind: 'done',
  title: '任务收束',
  parentNodeId: 'session:main-2',
  status: 'done',
});
assert.deepEqual(
  JSON.parse(JSON.stringify(hydratedCollections.nodeById.get('session:main-2')?.childNodeIds || [])),
  ['done:main-2'],
  'hydrated graph collections should remain appendable for mock/task-map augmentation flows',
);

console.log('test-workbench-graph-model: ok');
