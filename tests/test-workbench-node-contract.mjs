#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const source = readFileSync(
  join(repoRoot, 'static', 'chat', 'workbench/node-contract.js'),
  'utf8',
);

const context = { console };
context.globalThis = context;
context.window = context;
vm.runInNewContext(source, context, { filename: 'workbench/node-contract.js' });

const contract = context.MelodySyncWorkbenchNodeContract;
assert.ok(contract, 'node contract should be exposed on globalThis');
assert.deepEqual(JSON.parse(JSON.stringify(contract.NODE_KINDS)), ['main', 'branch', 'candidate', 'done']);
assert.deepEqual(JSON.parse(JSON.stringify(contract.NODE_LANES)), ['main', 'branch', 'side']);
assert.deepEqual(JSON.parse(JSON.stringify(contract.NODE_ROLES)), ['state', 'action', 'summary']);
assert.deepEqual(JSON.parse(JSON.stringify(contract.NODE_MERGE_POLICIES)), ['replace-latest', 'append']);
assert.deepEqual(JSON.parse(JSON.stringify(contract.NODE_INTERACTIONS)), ['open-session', 'create-branch', 'none']);
assert.deepEqual(JSON.parse(JSON.stringify(contract.NODE_EDGE_TYPES)), ['structural', 'suggestion', 'completion', 'merge']);
assert.deepEqual(JSON.parse(JSON.stringify(contract.NODE_LAYOUT_VARIANTS)), ['root', 'default', 'compact', 'panel']);
assert.deepEqual(JSON.parse(JSON.stringify(contract.NODE_CAPABILITIES)), ['open-session', 'create-branch', 'dismiss']);
assert.deepEqual(JSON.parse(JSON.stringify(contract.NODE_SURFACE_SLOTS)), ['task-map', 'composer-suggestions']);
assert.deepEqual(JSON.parse(JSON.stringify(contract.NODE_VIEW_TYPES)), ['flow-node', 'markdown', 'html', 'iframe']);
assert.deepEqual(JSON.parse(JSON.stringify(contract.NODE_TASK_CARD_BINDING_KEYS)), ['mainGoal', 'goal', 'candidateBranches', 'summary', 'checkpoint', 'nextSteps']);

const main = contract.getNodeKindDefinition('main');
assert.equal(main?.lane, 'main');
assert.equal(main?.role, 'state');
assert.equal(main?.mergePolicy, 'replace-latest');

const branch = contract.getNodeKindDefinition('branch');
assert.equal(branch?.lane, 'branch');
assert.equal(branch?.role, 'state');
assert.equal(branch?.mergePolicy, 'append');

const candidate = contract.getNodeKindDefinition('candidate');
assert.equal(candidate?.lane, 'branch');
assert.equal(candidate?.role, 'action');
assert.equal(candidate?.derived, true);
assert.equal(candidate?.composition?.defaultInteraction, 'create-branch');
assert.equal(candidate?.composition?.layoutVariant, 'compact');
assert.deepEqual(JSON.parse(JSON.stringify(candidate?.composition?.surfaceBindings || [])), ['task-map', 'composer-suggestions']);
assert.deepEqual(JSON.parse(JSON.stringify(candidate?.composition?.taskCardBindings || [])), ['candidateBranches']);
assert.equal(candidate?.composition?.defaultViewType, 'flow-node');

const done = contract.getNodeKindDefinition('done');
assert.equal(done?.role, 'summary');
assert.equal(done?.sessionBacked, false);
assert.equal(done?.composition?.defaultEdgeType, 'completion');
assert.equal(done?.composition?.countsAs?.completedSummary, true);

assert.equal(contract.isKnownNodeKind('main'), true);
assert.equal(contract.isKnownNodeKind('unknown'), false);

const bootstrapContext = {
  console,
  MelodySyncBootstrap: {
    getBootstrap() {
      return {
        workbench: {
          nodeLanes: ['main', 'branch', 'review'],
          nodeRoles: ['state', 'action', 'summary'],
          nodeMergePolicies: ['replace-latest', 'append'],
          nodeInteractions: ['open-session', 'none'],
          nodeEdgeTypes: ['structural', 'completion'],
          nodeLayoutVariants: ['root', 'default', 'compact', 'panel'],
          nodeCapabilities: ['open-session', 'dismiss'],
          nodeSurfaceSlots: ['task-map', 'composer-suggestions'],
          nodeViewTypes: ['flow-node', 'markdown'],
          nodeTaskCardBindingKeys: ['mainGoal', 'goal', 'reviewNotes'],
          nodeKindDefinitions: [
            {
              id: 'main',
              label: '主任务',
              description: '主任务根节点，对应主 session。',
              lane: 'main',
              role: 'state',
              sessionBacked: true,
              derived: false,
              mergePolicy: 'replace-latest',
            },
            {
              id: 'review',
              label: '复盘节点',
              description: '用户配置后可挂接的复盘型节点。',
              lane: 'review',
              role: 'summary',
              sessionBacked: false,
              derived: true,
              mergePolicy: 'append',
              composition: {
                canBeRoot: false,
                allowedParentKinds: ['main', 'review'],
                allowedChildKinds: [],
                requiresSourceSession: true,
                defaultInteraction: 'none',
                defaultEdgeType: 'completion',
                layoutVariant: 'compact',
                countsAs: {
                  sessionNode: false,
                  branch: false,
                  candidate: false,
                  completedSummary: true,
                },
              },
            },
          ],
        },
      };
    },
  },
};
bootstrapContext.globalThis = bootstrapContext;
bootstrapContext.window = bootstrapContext;
vm.runInNewContext(source, bootstrapContext, { filename: 'workbench/node-contract.js' });

const bootstrapContract = bootstrapContext.MelodySyncWorkbenchNodeContract;
assert.ok(bootstrapContract, 'bootstrap-backed node contract should be exposed on globalThis');
assert.deepEqual(
  JSON.parse(JSON.stringify(bootstrapContract.NODE_LANES)),
  ['main', 'branch', 'review'],
  'bootstrap-backed node lanes should override the local fallback',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(bootstrapContract.NODE_KINDS)),
  ['main', 'review'],
  'bootstrap-backed node definitions should override the local fallback list',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(bootstrapContract.NODE_INTERACTIONS)),
  ['open-session', 'none'],
  'bootstrap-backed node interactions should override the local fallback list',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(bootstrapContract.NODE_VIEW_TYPES)),
  ['flow-node', 'markdown'],
  'bootstrap-backed node view types should override the local fallback list',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(bootstrapContract.NODE_TASK_CARD_BINDING_KEYS)),
  ['mainGoal', 'goal', 'reviewNotes'],
  'bootstrap-backed task-card binding keys should override the local fallback list',
);
assert.equal(
  bootstrapContract.getNodeKindDefinition('review')?.label,
  '复盘节点',
  'bootstrap-backed node definitions should be queryable by kind',
);
assert.equal(
  bootstrapContract.getNodeKindDefinition('review')?.mergePolicy,
  'append',
  'bootstrap-backed node definitions should retain their merge policy',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(bootstrapContract.getNodeKindDefinition('review')?.composition?.allowedParentKinds)),
  ['main', 'review'],
  'bootstrap-backed composition rules should be preserved',
);
assert.equal(
  bootstrapContract.isKnownNodeKind('review'),
  true,
  'bootstrap-backed node definitions should be recognized as known kinds',
);

console.log('test-workbench-node-contract: ok');
