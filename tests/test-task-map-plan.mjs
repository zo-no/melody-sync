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
const graphModelSource = readWorkbenchFrontendSource('graph-model.js');
const taskMapPlanSource = readWorkbenchFrontendSource('task-map-plan.js');

const context = { console };
context.globalThis = context;
context.window = context;

vm.runInNewContext(nodeContractSource, context, { filename: 'workbench/node-contract.js' });
vm.runInNewContext(nodeEffectsSource, context, { filename: 'workbench/node-effects.js' });
vm.runInNewContext(nodeInstanceSource, context, { filename: 'workbench/node-instance.js' });
vm.runInNewContext(graphModelSource, context, { filename: 'workbench/graph-model.js' });
vm.runInNewContext(taskMapPlanSource, context, { filename: 'workbench/task-map-plan.js' });

const api = context.MelodySyncTaskMapPlan;
assert.ok(api, 'task map plan api should be exposed on globalThis');
assert.equal(typeof api.normalizeTaskMapPlan, 'function');
assert.equal(typeof api.applyTaskMapPlansToProjection, 'function');
assert.equal(typeof api.collectSurfaceNodes, 'function');

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

const baseQuest = api.buildQuestFromGraphData({
  questId: 'quest:main-1',
  rootSessionId: 'main-1',
  title: '默认任务图',
  nodes: [
    {
      id: 'session:main-1',
      kind: 'main',
      title: '主任务',
      summary: '默认 continuity 投影',
      sessionId: 'main-1',
      sourceSessionId: 'main-1',
      parentNodeId: null,
      status: 'current',
      lineRole: 'main',
    },
  ],
});

assert.ok(baseQuest, 'task map plan helper should build quest-shaped graph data');

const baseQuestWithCandidate = api.buildQuestFromGraphData({
  questId: 'quest:main-1',
  rootSessionId: 'main-1',
  title: '默认任务图',
  nodes: [
    {
      id: 'session:main-1',
      kind: 'main',
      title: '主任务',
      summary: '默认 continuity 投影',
      sessionId: 'main-1',
      sourceSessionId: 'main-1',
      parentNodeId: null,
      status: 'current',
      lineRole: 'main',
    },
    {
      id: 'candidate:main-1:review',
      kind: 'candidate',
      title: '补充复盘支线',
      summary: '默认候选节点',
      sourceSessionId: 'main-1',
      parentNodeId: 'session:main-1',
      status: 'candidate',
      lineRole: 'candidate',
    },
  ],
});

const augmentPlan = api.normalizeTaskMapPlan({
  rootSessionId: 'main-1',
  mode: 'augment-default',
  nodes: [
    {
      id: 'candidate:main-1:review',
      kind: 'candidate',
      title: '补充复盘支线',
      summary: '建议拆分',
      sourceSessionId: 'main-1',
      parentId: 'session:main-1',
      status: 'candidate',
      capabilities: ['create-branch', 'dismiss'],
      surfaceBindings: ['task-map', 'composer-suggestions'],
      taskCardBindings: ['candidateBranches'],
      view: {
        type: 'markdown',
        content: '## 复盘建议',
        width: 420,
        height: 280,
      },
    },
  ],
  edges: [
    {
      from: 'session:main-1',
      to: 'candidate:main-1:review',
      type: 'suggestion',
    },
  ],
});

assert.equal(augmentPlan?.mode, 'augment-default');
assert.equal(augmentPlan?.nodes[0]?.parentNodeId, 'session:main-1');
assert.equal(augmentPlan?.nodes[0]?.view?.type, 'markdown');
assert.equal(augmentPlan?.nodes[0]?.view?.width, 420);
assert.deepEqual(toPlain(augmentPlan?.nodes[0]?.capabilities || []), ['create-branch', 'dismiss']);
assert.deepEqual(toPlain(augmentPlan?.nodes[0]?.surfaceBindings || []), ['task-map', 'composer-suggestions']);
assert.deepEqual(toPlain(augmentPlan?.nodes[0]?.taskCardBindings || []), ['candidateBranches']);

const augmentedProjection = api.applyTaskMapPlansToProjection({
  projection: { mainQuests: [baseQuest] },
  snapshot: { taskMapPlans: [augmentPlan] },
});

assert.equal(augmentedProjection.mainQuests.length, 1, 'augment mode should reuse the existing quest');
assert.equal(
  augmentedProjection.mainQuests[0]?.nodes.some((node) => node.id === 'candidate:main-1:review'),
  true,
  'augment mode should append new plan nodes onto the default projection',
);
assert.equal(
  augmentedProjection.mainQuests[0]?.nodes.find((node) => node.id === 'candidate:main-1:review')?.view?.type,
  'markdown',
  'augment mode should preserve node rich-view declarations',
);
assert.equal(
  augmentedProjection.mainQuests[0]?.edges.find((edge) => edge.toNodeId === 'candidate:main-1:review')?.type,
  'suggestion',
  'augment mode should preserve explicit edge semantics',
);
assert.equal(
  augmentedProjection.mainQuests[0]?.counts?.candidateBranches,
  1,
  'augment mode should recalculate candidate counts from the merged graph',
);

const mergedProjection = api.applyTaskMapPlansToProjection({
  projection: { mainQuests: [baseQuestWithCandidate] },
  snapshot: { taskMapPlans: [augmentPlan] },
});

const mergedCandidateNode = mergedProjection.mainQuests[0]?.nodes.find((node) => node.id === 'candidate:main-1:review');
assert.ok(mergedCandidateNode, 'augment mode should keep existing default nodes when the plan reuses the same node id');
assert.equal(
  mergedProjection.mainQuests[0]?.nodes.length,
  2,
  'augment mode should merge matching node ids instead of duplicating the default candidate node',
);
assert.equal(
  mergedCandidateNode?.summary,
  '建议拆分',
  'augment mode should let the plan override summary metadata on an existing default node',
);
assert.equal(
  mergedCandidateNode?.view?.type,
  'markdown',
  'augment mode should attach rich-view metadata onto an existing default node when ids match',
);
assert.deepEqual(
  toPlain(mergedCandidateNode?.surfaceBindings || []),
  ['task-map', 'composer-suggestions'],
  'augment mode should merge surface bindings onto an existing default node when ids match',
);
assert.deepEqual(
  toPlain(mergedCandidateNode?.taskCardBindings || []),
  ['candidateBranches'],
  'augment mode should preserve task-card binding metadata on merged node instances',
);
assert.equal(
  mergedCandidateNode?.origin?.type,
  'plan',
  'augment mode should mark plan-enriched nodes with plan origin metadata',
);
assert.deepEqual(
  toPlain(api.collectSurfaceNodes({
    projection: mergedProjection,
    rootSessionId: 'main-1',
    sourceSessionId: 'main-1',
    surfaceSlot: 'composer-suggestions',
  }).map((node) => ({
    id: node.id,
    title: node.title,
    summary: node.summary,
  }))),
  [
    {
      id: 'candidate:main-1:review',
      title: '补充复盘支线',
      summary: '建议拆分',
    },
  ],
  'surface collection should expose merged plan-backed nodes for the matching session surface slot',
);

const replaceProjection = api.applyTaskMapPlansToProjection({
  projection: { mainQuests: [baseQuest] },
  snapshot: {
    taskMapPlans: [
      {
        rootSessionId: 'main-1',
        mode: 'replace-default',
        title: 'AI 规划图',
        summary: '由 plan 覆盖默认 continuity 图',
        activeNodeId: 'plan:main-1:branch',
        nodes: [
          {
            id: 'plan:main-1',
            kind: 'main',
            title: 'AI 主图',
            sourceSessionId: 'main-1',
            parentNodeId: null,
            status: 'active',
            lineRole: 'main',
          },
          {
            id: 'plan:main-1:branch',
            kind: 'branch',
            title: '拆分支线',
            sourceSessionId: 'main-1',
            parentNodeId: 'plan:main-1',
            status: 'active',
            lineRole: 'branch',
          },
        ],
      },
    ],
  },
});

assert.equal(replaceProjection.mainQuests.length, 1, 'replace mode should still keep one quest for the same root session');
assert.equal(replaceProjection.mainQuests[0]?.title, 'AI 规划图');
assert.equal(
  replaceProjection.mainQuests[0]?.nodes.some((node) => node.id === 'session:main-1'),
  false,
  'replace mode should fully replace the default continuity root node list',
);
assert.equal(
  replaceProjection.mainQuests[0]?.currentNodeId,
  'plan:main-1:branch',
  'replace mode should honor the plan-selected active node inside the replaced quest',
);
assert.equal(
  replaceProjection.mainQuests[0]?.nodes.find((node) => node.id === 'plan:main-1:branch')?.origin?.type,
  'plan',
  'replace mode should mark replacement nodes as plan-originated graph instances',
);
assert.deepEqual(
  toPlain(replaceProjection.mainQuests[0]?.edgeIds || []),
  ['edge:plan:main-1:plan:main-1:branch'],
  'replace mode should synthesize structural edges from parent links',
);

assert.equal(
  api.normalizeTaskMapPlan({
    rootSessionId: 'main-2',
    nodes: [{ id: 'invalid:node', kind: 'missing-kind' }],
  }),
  null,
  'task map plans should reject plans that do not contain any known node kinds',
);

console.log('test-task-map-plan: ok');
