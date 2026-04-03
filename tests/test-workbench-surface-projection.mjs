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
const graphModelSource = readFileSync(
  join(repoRoot, 'static', 'chat', 'workbench', 'graph-model.js'),
  'utf8',
);
const taskMapPlanSource = readFileSync(
  join(repoRoot, 'static', 'chat', 'workbench', 'task-map-plan.js'),
  'utf8',
);
const surfaceProjectionSource = readFileSync(
  join(repoRoot, 'static', 'chat', 'workbench', 'surface-projection.js'),
  'utf8',
);

const context = { console };
context.globalThis = context;
context.window = context;
const fetchCalls = [];
context.fetchJsonOrRedirect = async (url) => {
  fetchCalls.push(url);
  return {
    rootSessionId: 'main-1',
    surfaceSlot: 'composer-suggestions',
    entries: [
      {
        id: 'candidate:main-1:server',
        text: '从 backend canonical surface 返回',
        summary: 'surface cache 应该优先返回后端 slot payload',
        capabilities: ['create-branch', 'dismiss'],
        sourceSessionId: 'main-1',
        taskCardBindings: ['candidateBranches'],
        origin: {
          type: 'plan',
          planId: 'plan:server',
          sourceId: 'manual',
          sourceLabel: '',
          hookId: '',
        },
      },
    ],
  };
};

vm.runInNewContext(nodeContractSource, context, { filename: 'workbench/node-contract.js' });
vm.runInNewContext(nodeEffectsSource, context, { filename: 'workbench/node-effects.js' });
vm.runInNewContext(nodeInstanceSource, context, { filename: 'workbench/node-instance.js' });
vm.runInNewContext(graphModelSource, context, { filename: 'workbench/graph-model.js' });
vm.runInNewContext(taskMapPlanSource, context, { filename: 'workbench/task-map-plan.js' });
vm.runInNewContext(surfaceProjectionSource, context, { filename: 'workbench/surface-projection.js' });

const planApi = context.MelodySyncTaskMapPlan;
const surfaceApi = context.MelodySyncWorkbenchSurfaceProjection;

assert.ok(surfaceApi, 'surface projection api should be exposed on globalThis');
assert.equal(typeof surfaceApi.collectSurfaceNodesForSession, 'function');
assert.equal(typeof surfaceApi.buildComposerSuggestionEntries, 'function');

const projection = planApi.applyTaskMapPlansToProjection({
  projection: {
    mainQuests: [
      planApi.buildQuestFromGraphData({
        questId: 'quest:main-1',
        rootSessionId: 'main-1',
        title: '默认任务图',
        nodes: [
          {
            id: 'session:main-1',
            kind: 'main',
            title: '主任务',
            sessionId: 'main-1',
            sourceSessionId: 'main-1',
            parentNodeId: null,
            status: 'current',
            lineRole: 'main',
          },
          {
            id: 'candidate:main-1:review',
            kind: 'candidate',
            title: '默认候选',
            sourceSessionId: 'main-1',
            parentNodeId: 'session:main-1',
            status: 'candidate',
            lineRole: 'candidate',
          },
        ],
      }),
    ],
  },
  snapshot: {
    taskMapPlans: [
      {
        id: 'plan:main-1',
        rootSessionId: 'main-1',
        mode: 'augment-default',
        source: {
          type: 'hook',
          hookId: 'builtin.branch-candidates',
          event: 'branch.suggested',
        },
        nodes: [
          {
            id: 'candidate:main-1:review',
            kind: 'candidate',
            title: '从 surface projection 取建议',
            summary: 'surface projection 应该返回合并后的候选节点',
            sourceSessionId: 'main-1',
            parentId: 'session:main-1',
            status: 'candidate',
            surfaceBindings: ['task-map', 'composer-suggestions'],
            capabilities: ['create-branch', 'dismiss'],
          },
        ],
      },
    ],
  },
});

const nodes = surfaceApi.collectSurfaceNodesForSession({
  session: { id: 'main-1', rootSessionId: 'main-1' },
  surfaceSlot: 'composer-suggestions',
  projection,
});

assert.equal(nodes.length, 1, 'surface projection should return matching composer-suggestion nodes for the session');
assert.equal(nodes[0].id, 'candidate:main-1:review');
assert.equal(nodes[0].summary, 'surface projection 应该返回合并后的候选节点');

const entries = surfaceApi.buildComposerSuggestionEntries({
  session: { id: 'main-1', rootSessionId: 'main-1' },
  projection,
});

assert.deepEqual(
  JSON.parse(JSON.stringify(entries)),
  [
    {
      id: 'candidate:main-1:review',
      text: '从 surface projection 取建议',
      summary: 'surface projection 应该返回合并后的候选节点',
      capabilities: ['create-branch', 'dismiss'],
      sourceSessionId: 'main-1',
      taskCardBindings: ['candidateBranches'],
      origin: {
        type: 'plan',
        planId: 'plan:main-1',
        sourceId: 'builtin.branch-candidates',
        sourceLabel: 'branch.suggested',
        hookId: 'builtin.branch-candidates',
      },
    },
  ],
  'surface projection should produce composer entries from merged candidate nodes',
);

const prefetchedEntries = await surfaceApi.prefetchSurfaceEntriesForSession({
  session: { id: 'main-1', rootSessionId: 'main-1' },
  surfaceSlot: 'composer-suggestions',
  force: true,
});
assert.deepEqual(
  JSON.parse(JSON.stringify(prefetchedEntries)),
  [
    {
      id: 'candidate:main-1:server',
      text: '从 backend canonical surface 返回',
      summary: 'surface cache 应该优先返回后端 slot payload',
      capabilities: ['create-branch', 'dismiss'],
      sourceSessionId: 'main-1',
      taskCardBindings: ['candidateBranches'],
      origin: {
        type: 'plan',
        planId: 'plan:server',
        sourceId: 'manual',
        sourceLabel: '',
        hookId: '',
      },
    },
  ],
  'surface projection should cache canonical backend surface entries when available',
);
assert.deepEqual(
  fetchCalls,
  ['/api/workbench/sessions/main-1/task-map-surfaces/composer-suggestions'],
  'surface projection should read canonical surface entries from the session-scoped backend endpoint',
);

const cachedEntries = surfaceApi.buildComposerSuggestionEntries({
  session: { id: 'main-1', rootSessionId: 'main-1' },
});
assert.deepEqual(
  JSON.parse(JSON.stringify(cachedEntries)),
  [
    {
      id: 'candidate:main-1:server',
      text: '从 backend canonical surface 返回',
      summary: 'surface cache 应该优先返回后端 slot payload',
      capabilities: ['create-branch', 'dismiss'],
      sourceSessionId: 'main-1',
      taskCardBindings: ['candidateBranches'],
      origin: {
        type: 'plan',
        planId: 'plan:server',
        sourceId: 'manual',
        sourceLabel: '',
        hookId: '',
      },
    },
  ],
  'surface projection should prefer cached backend surface entries over local projection fallback after prefetch',
);

console.log('test-workbench-surface-projection: ok');
