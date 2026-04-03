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
const taskMapPlanSource = readFileSync(
  join(repoRoot, 'static', 'chat', 'workbench', 'task-map-plan.js'),
  'utf8',
);

const context = { console };
context.globalThis = context;
context.window = context;

vm.runInNewContext(nodeContractSource, context, { filename: 'workbench/node-contract.js' });
vm.runInNewContext(nodeEffectsSource, context, { filename: 'workbench/node-effects.js' });
vm.runInNewContext(taskMapPlanSource, context, { filename: 'workbench/task-map-plan.js' });

const api = context.MelodySyncTaskMapPlan;
assert.ok(api, 'task map plan api should be exposed on globalThis');
assert.equal(typeof api.normalizeTaskMapPlan, 'function');
assert.equal(typeof api.applyTaskMapPlansToProjection, 'function');

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

const augmentPlan = api.normalizeTaskMapPlan({
  rootSessionId: 'main-1',
  mode: 'augment-default',
  nodes: [
    {
      id: 'candidate:main-1:review',
      kind: 'candidate',
      title: '补充复盘支线',
      summary: '建议拆成独立支线',
      sourceSessionId: 'main-1',
      parentId: 'session:main-1',
      status: 'candidate',
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
  augmentedProjection.mainQuests[0]?.edges.find((edge) => edge.toNodeId === 'candidate:main-1:review')?.type,
  'suggestion',
  'augment mode should preserve explicit edge semantics',
);
assert.equal(
  augmentedProjection.mainQuests[0]?.counts?.candidateBranches,
  1,
  'augment mode should recalculate candidate counts from the merged graph',
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
