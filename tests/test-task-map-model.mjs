#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

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
const taskRunStatusSource = readWorkbenchFrontendSource('task-run-status.js');
const nodeEffectsSource = readWorkbenchFrontendSource('node-effects.js');
const nodeInstanceSource = readWorkbenchFrontendSource('node-instance.js');
const graphModelSource = readWorkbenchFrontendSource('graph-model.js');
const taskMapPlanSource = readWorkbenchFrontendSource('task-map-plan.js');
const taskMapClustersSource = readWorkbenchFrontendSource('task-map-clusters.js');
const taskMapMockPresetsSource = readWorkbenchFrontendSource('task-map-mock-presets.js');
const source = readWorkbenchFrontendSource('task-map-model.js');

const context = {
  console,
  window: {},
};
context.globalThis = context;
vm.runInNewContext(nodeContractSource, context, {
  filename: 'frontend-src/workbench/node-contract.js',
});
vm.runInNewContext(taskRunStatusSource, context, {
  filename: 'frontend-src/workbench/task-run-status.js',
});
vm.runInNewContext(nodeEffectsSource, context, {
  filename: 'frontend-src/workbench/node-effects.js',
});
vm.runInNewContext(nodeInstanceSource, context, {
  filename: 'frontend-src/workbench/node-instance.js',
});
vm.runInNewContext(graphModelSource, context, {
  filename: 'frontend-src/workbench/graph-model.js',
});
vm.runInNewContext(taskMapPlanSource, context, {
  filename: 'frontend-src/workbench/task-map-plan.js',
});
vm.runInNewContext(taskMapClustersSource, context, {
  filename: 'frontend-src/workbench/task-map-clusters.js',
});
vm.runInNewContext(taskMapMockPresetsSource, context, {
  filename: 'frontend-src/workbench/task-map-mock-presets.js',
});
vm.runInNewContext(source, context, {
  filename: 'frontend-src/workbench/task-map-model.js',
});

const { buildTaskMapProjection, applyTaskMapMockPreset, NODE_KINDS } = context.window.MelodySyncTaskMapModel;
assert.equal(typeof buildTaskMapProjection, 'function', 'task map model should expose a projection builder');
assert.equal(typeof applyTaskMapMockPreset, 'function', 'task map model should expose a mock-preset applicator');
assert.deepEqual(JSON.parse(JSON.stringify(NODE_KINDS)), ['main', 'branch', 'candidate', 'note', 'done']);

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

const mainSession = {
  id: 'main-1',
  name: '学习电影史',
  updatedAt: '2026-03-29T09:00:00.000Z',
  taskCard: {
    goal: '学习电影史',
    mainGoal: '学习电影史',
    checkpoint: '先搭建电影史主线框架',
    candidateBranches: ['表现主义', '法国新浪潮', '黑色电影'],
  },
};

const branchSession = {
  id: 'branch-1',
  name: 'Branch · 表现主义',
  updatedAt: '2026-03-29T09:20:00.000Z',
  taskCard: {
    goal: '表现主义',
    mainGoal: '学习电影史',
    lineRole: 'branch',
    checkpoint: '先把表现主义的关键特征讲清楚',
    candidateBranches: ['卡里加里博士'],
  },
};

const nestedBranchSession = {
  id: 'branch-1-1',
  name: 'Branch · 德国表现主义电影',
  updatedAt: '2026-03-29T09:35:00.000Z',
  taskCard: {
    goal: '德国表现主义电影',
    mainGoal: '学习电影史',
    lineRole: 'branch',
    checkpoint: '对比卡里加里博士和诺斯费拉图',
  },
};

const parkedBranchSession = {
  id: 'branch-2',
  name: 'Branch · 法国新浪潮',
  updatedAt: '2026-03-29T08:55:00.000Z',
  taskCard: {
    goal: '法国新浪潮',
    mainGoal: '学习电影史',
    lineRole: 'branch',
    checkpoint: '补充跳切和作者论',
  },
};

const syntheticMainSession = {
  id: 'main-2',
  name: '整理写作计划',
  updatedAt: '2026-03-29T07:30:00.000Z',
  taskCard: {
    goal: '整理写作计划',
    checkpoint: '先拆出提纲和素材',
    candidateBranches: ['整理参考书'],
  },
};

const syntheticBranchSession = {
  id: 'branch-3',
  name: 'Branch · 提纲拆解',
  updatedAt: '2026-03-29T07:40:00.000Z',
  sourceContext: { parentSessionId: 'main-2' },
  taskCard: {
    goal: '提纲拆解',
    mainGoal: '整理写作计划',
    lineRole: 'branch',
    checkpoint: '先把章节结构列出来',
  },
};

const projection = buildTaskMapProjection({
  snapshot: {
    taskClusters: [
      {
        mainSessionId: 'main-1',
        mainSession,
        mainGoal: '学习电影史',
        currentBranchSessionId: 'branch-1-1',
        branchSessionIds: ['branch-1', 'branch-1-1', 'branch-2'],
        branchSessions: [
          {
            ...branchSession,
            _branchDepth: 1,
            _branchParentSessionId: 'main-1',
            _branchStatus: 'active',
          },
          {
            ...nestedBranchSession,
            _branchDepth: 2,
            _branchParentSessionId: 'branch-1',
            _branchStatus: 'active',
          },
          {
            ...parkedBranchSession,
            _branchDepth: 1,
            _branchParentSessionId: 'main-1',
            _branchStatus: 'parked',
          },
        ],
      },
    ],
  },
  sessions: [
    mainSession,
    branchSession,
    nestedBranchSession,
    parkedBranchSession,
    syntheticMainSession,
    syntheticBranchSession,
  ],
  currentSessionId: 'branch-1-1',
});

assert.equal(projection.mainQuests.length, 2, 'projection should include both snapshot-backed and synthetic main quests');
assert.equal(projection.activeMainQuest?.rootSessionId, 'main-1', 'active quest should follow the current session lineage');
assert.equal(projection.activeNode?.sessionId, 'branch-1-1', 'active node should match the current branch session');
assert.equal(projection.activeNode?.title, '德国表现主义电影', 'active node should expose the branch title as the current work item');

const movieQuest = projection.mainQuests.find((quest) => quest.rootSessionId === 'main-1');
assert.ok(movieQuest, 'snapshot-backed main quest should be present');
assert.deepEqual(
  toPlain(movieQuest.currentPathNodeIds),
  ['session:branch-1', 'session:branch-1-1'],
  'current path should capture the active branch lineage without duplicating the root node',
);
assert.equal(movieQuest.counts.activeBranches, 2, 'quest counts should keep both active branch nodes');
assert.equal(movieQuest.counts.parkedBranches, 1, 'quest counts should reflect parked sibling branches');
assert.equal(movieQuest.counts.candidateBranches, 2, 'quest counts should include candidate nodes that are not yet real branches');

const rootNode = movieQuest.nodes.find((node) => node.id === 'session:main-1');
assert.ok(rootNode, 'main quest should include a root node');
assert.deepEqual(
  toPlain(rootNode.childNodeIds),
  ['session:branch-1', 'session:branch-2', 'candidate:main-1:黑色电影'],
  'root node should include real branch children first and append only non-duplicated candidate branches',
);

const expressionismNode = movieQuest.nodes.find((node) => node.id === 'session:branch-1');
assert.ok(expressionismNode, 'active branch node should be present');
assert.equal(expressionismNode.isCurrentPath, true, 'parent branch should stay marked as part of the current path');
assert.deepEqual(
  toPlain(expressionismNode.childNodeIds),
  ['session:branch-1-1', 'candidate:branch-1:卡里加里博士'],
  'branch nodes should carry both nested branches and candidate child nodes',
);

const candidateNode = movieQuest.nodes.find((node) => node.id === 'candidate:main-1:黑色电影');
assert.ok(candidateNode, 'unrealized candidate branches should be surfaced as candidate nodes');
assert.equal(candidateNode.kind, 'candidate', 'candidate nodes should keep a dedicated node kind');
assert.equal(candidateNode.parentNodeId, 'session:main-1', 'root-level candidates should stay attached to the main quest root');
assert.equal(
  movieQuest.edges.find((edge) => edge.toNodeId === 'candidate:main-1:黑色电影')?.type,
  'suggestion',
  'candidate nodes should carry explicit suggestion edges in the projection',
);

const switchedProjection = buildTaskMapProjection({
  snapshot: {
    taskClusters: [
      {
        mainSessionId: 'main-1',
        mainSession,
        mainGoal: '学习电影史',
        currentBranchSessionId: 'branch-2',
        branchSessionIds: ['branch-1', 'branch-1-1', 'branch-2'],
        branchSessions: [
          {
            ...branchSession,
            _branchDepth: 1,
            _branchParentSessionId: 'main-1',
            _branchStatus: 'parked',
          },
          {
            ...nestedBranchSession,
            _branchDepth: 2,
            _branchParentSessionId: 'branch-1',
            _branchStatus: 'parked',
          },
          {
            ...parkedBranchSession,
            _branchDepth: 1,
            _branchParentSessionId: 'main-1',
            _branchStatus: 'active',
          },
        ],
      },
    ],
  },
  sessions: [
    mainSession,
    branchSession,
    nestedBranchSession,
    parkedBranchSession,
    syntheticMainSession,
    syntheticBranchSession,
  ],
  currentSessionId: 'branch-2',
});

const switchedMovieQuest = switchedProjection.mainQuests.find((quest) => quest.rootSessionId === 'main-1');
assert.ok(switchedMovieQuest, 'switching the active branch should still keep the same main quest projection');
const switchedRootNode = switchedMovieQuest.nodes.find((node) => node.id === 'session:main-1');
assert.ok(switchedRootNode, 'switched projection should still include the same root node');
assert.deepEqual(
  toPlain(switchedRootNode.childNodeIds),
  toPlain(rootNode.childNodeIds),
  'switching to another branch should not reshuffle sibling order under the same parent node',
);

const mergedProjection = buildTaskMapProjection({
  snapshot: {
    taskClusters: [
      {
        mainSessionId: 'main-1',
        mainSession,
        mainGoal: '学习电影史',
        currentBranchSessionId: '',
        branchSessionIds: ['branch-1'],
        branchSessions: [
          {
            ...branchSession,
            _branchDepth: 1,
            _branchParentSessionId: 'main-1',
            _branchStatus: 'merged',
          },
        ],
      },
    ],
  },
  sessions: [mainSession, branchSession],
  currentSessionId: 'main-1',
});
const mergedQuest = mergedProjection.mainQuests.find((quest) => quest.rootSessionId === 'main-1');
assert.equal(
  mergedQuest.edges.find((edge) => edge.toNodeId === 'done:main-1')?.type,
  'completion',
  'done nodes should carry explicit completion edges in the projection',
);

const augmentedProjection = buildTaskMapProjection({
  snapshot: {
    taskClusters: [
      {
        mainSessionId: 'main-1',
        mainSession,
        mainGoal: '学习电影史',
        currentBranchSessionId: '',
        branchSessionIds: [],
        branchSessions: [],
      },
    ],
    taskMapPlans: [
      {
        rootSessionId: 'main-1',
        mode: 'augment-default',
        nodes: [
          {
            id: 'candidate:main-1:补充复盘',
            kind: 'candidate',
            title: '补充复盘',
            summary: '建议拆分',
            sourceSessionId: 'main-1',
            parentNodeId: 'session:main-1',
            status: 'candidate',
          },
        ],
        edges: [
          {
            from: 'session:main-1',
            to: 'candidate:main-1:补充复盘',
            type: 'suggestion',
          },
        ],
      },
    ],
  },
  sessions: [mainSession],
  currentSessionId: 'main-1',
});
const augmentedQuest = augmentedProjection.mainQuests.find((quest) => quest.rootSessionId === 'main-1');
assert.equal(
  augmentedQuest.nodes.some((node) => node.id === 'candidate:main-1:补充复盘'),
  true,
  'task map plans should be able to augment the default continuity quest with extra nodes',
);
assert.equal(
  augmentedQuest.edges.find((edge) => edge.toNodeId === 'candidate:main-1:补充复盘')?.type,
  'suggestion',
  'task map plans should preserve explicit edge semantics after projection',
);
assert.equal(
  augmentedQuest.counts.candidateBranches,
  4,
  'task map plan augmentation should be reflected in quest counts together with default candidates',
);

const focusedProjection = buildTaskMapProjection({
  snapshot: {
    taskClusters: [
      {
        mainSessionId: 'main-1',
        mainSession,
        mainGoal: '学习电影史',
        currentBranchSessionId: 'branch-2',
        branchSessionIds: ['branch-1', 'branch-1-1', 'branch-2'],
        branchSessions: [
          {
            ...branchSession,
            _branchDepth: 1,
            _branchParentSessionId: 'main-1',
            _branchStatus: 'parked',
          },
          {
            ...nestedBranchSession,
            _branchDepth: 2,
            _branchParentSessionId: 'branch-1',
            _branchStatus: 'active',
          },
          {
            ...parkedBranchSession,
            _branchDepth: 1,
            _branchParentSessionId: 'main-1',
            _branchStatus: 'active',
          },
        ],
      },
    ],
  },
  sessions: [
    mainSession,
    branchSession,
    nestedBranchSession,
    parkedBranchSession,
    syntheticMainSession,
    syntheticBranchSession,
  ],
  currentSessionId: 'main-1',
  focusedSessionId: 'branch-1-1',
});

assert.equal(
  focusedProjection.activeMainQuest?.rootSessionId,
  'main-1',
  'an optimistic focused session should still keep the same main quest active',
);
assert.equal(
  focusedProjection.activeNode?.sessionId,
  'branch-1-1',
  'focused session override should win over a stale cluster currentBranchSessionId',
);
assert.deepEqual(
  toPlain(focusedProjection.activeMainQuest?.currentPathNodeIds || []),
  ['session:branch-1', 'session:branch-1-1'],
  'focused session override should also update the rendered current path lineage',
);

const syntheticQuest = projection.mainQuests.find((quest) => quest.rootSessionId === 'main-2');
assert.ok(syntheticQuest, 'sessions without a server task cluster should still project into a synthetic main quest');
assert.equal(syntheticQuest.nodes[0]?.id, 'session:main-2', 'synthetic quest should start from its root session node');
assert.equal(syntheticQuest.nodes[1]?.id, 'session:branch-3', 'synthetic quest should retain branch children inferred from session parent links');
assert.equal(
  syntheticQuest.nodes[2]?.id,
  'candidate:main-2:整理参考书',
  'synthetic quests should still surface candidate branches from task cards',
);

const mockedProjection = applyTaskMapMockPreset(projection, 'cinema');
const mockedQuest = mockedProjection.mainQuests.find((quest) => quest.rootSessionId === 'main-1');
assert.ok(mockedQuest, 'mock preset should keep the active quest');
assert.equal(
  projection.mainQuests.find((quest) => quest.rootSessionId === 'main-1')?.nodes.some((node) => String(node.id).startsWith('mock:cinema:')),
  false,
  'applying a mock preset should not mutate the original projection',
);
assert.equal(
  mockedQuest.nodes.some((node) => node.id === 'mock:cinema:branch:visual-style'),
  true,
  'cinema mock preset should inject a stable opened side quest',
);
assert.equal(
  mockedQuest.nodes.some((node) => node.id === 'mock:cinema:candidate:film-list'),
  true,
  'cinema mock preset should inject stable candidate branches for UI testing',
);
assert.equal(
  mockedQuest.counts.candidateBranches >= movieQuest.counts.candidateBranches,
  true,
  'mock preset should increase or preserve candidate branch counts after injection',
);

console.log('test-task-map-model: ok');
