#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const tempHome = mkdtempSync(join(tmpdir(), 'workbench-node-user-flow-'));
mkdirSync(join(tempHome, '.config', 'melody-sync'), { recursive: true });
process.env.HOME = tempHome;

function loadFrontendModule(relativePath) {
  return readFileSync(join(repoRoot, 'frontend', 'workbench', relativePath), 'utf8');
}

try {
  const nodeSettingsStore = await import(
    pathToFileURL(join(repoRoot, 'backend/workbench/node-settings-store.mjs')).href
  );
  const nodeDefinitionsModule = await import(
    pathToFileURL(join(repoRoot, 'backend/workbench/node-definitions.mjs')).href
  );
  const producers = await import(
    pathToFileURL(join(repoRoot, 'backend/workbench/task-map-plan-producers.mjs')).href
  );
  const backendNodeInstance = await import(
    pathToFileURL(join(repoRoot, 'backend/workbench/node-instance.mjs')).href
  );
  const backendNodeTaskCard = await import(
    pathToFileURL(join(repoRoot, 'backend/workbench/node-task-card.mjs')).href
  );

  function toPlain(value) {
    return JSON.parse(JSON.stringify(value));
  }

  await nodeSettingsStore.createCustomNodeKind({
    id: 'goal-panel',
    label: '目标节点',
    description: '在地图上显式表达当前阶段目标。',
    lane: 'main',
    role: 'summary',
    mergePolicy: 'replace-latest',
    composition: {
      canBeRoot: false,
      allowedParentKinds: ['main'],
      allowedChildKinds: [],
      requiresSourceSession: true,
      defaultInteraction: 'none',
      defaultEdgeType: 'completion',
      defaultViewType: 'markdown',
      layoutVariant: 'panel',
      surfaceBindings: ['task-map'],
      taskCardBindings: ['mainGoal', 'summary'],
      countsAs: {
        sessionNode: false,
        branch: false,
        candidate: false,
        completedSummary: true,
      },
    },
  });

  const nodeDefinitionsPayload = nodeDefinitionsModule.createWorkbenchNodeDefinitionsPayload();
  const customGoalDefinition = nodeDefinitionsPayload.nodeKindDefinitions.find((definition) => definition.id === 'goal-panel');
  assert.ok(customGoalDefinition, 'custom node kind should flow into the canonical node definitions payload');
  assert.deepEqual(customGoalDefinition.composition.taskCardBindings, ['mainGoal', 'summary']);
  assert.equal(customGoalDefinition.composition.defaultViewType, 'markdown');

  const context = {
    console,
    MelodySyncBootstrap: {
      getBootstrap() {
        return {
          workbench: nodeDefinitionsPayload,
        };
      },
    },
    window: {},
  };
  context.globalThis = context;
  context.window = context;

  const moduleSources = [
    ['node-contract.js', loadFrontendModule('node-contract.js')],
    ['node-effects.js', loadFrontendModule('node-effects.js')],
    ['node-instance.js', loadFrontendModule('node-instance.js')],
    ['graph-model.js', loadFrontendModule('graph-model.js')],
    ['node-capabilities.js', loadFrontendModule('node-capabilities.js')],
    ['node-task-card.js', loadFrontendModule('node-task-card.js')],
    ['task-map-plan.js', loadFrontendModule('task-map-plan.js')],
    ['surface-projection.js', loadFrontendModule('surface-projection.js')],
    ['task-map-clusters.js', loadFrontendModule('task-map-clusters.js')],
    ['task-map-mock-presets.js', loadFrontendModule('task-map-mock-presets.js')],
    ['task-map-model.js', loadFrontendModule('task-map-model.js')],
    ['node-rich-view-ui.js', loadFrontendModule('node-rich-view-ui.js')],
    ['node-canvas-ui.js', loadFrontendModule('node-canvas-ui.js')],
  ];
  for (const [filename, source] of moduleSources) {
    vm.runInNewContext(source, context, { filename: `workbench/${filename}` });
  }

  const sessions = [
    {
      id: 'main-1',
      rootSessionId: 'main-1',
      name: '整理 node 驱动页面表达',
      updatedAt: '2026-04-03T12:00:00.000Z',
      taskCard: {
        goal: '整理 node 驱动页面表达',
        mainGoal: '整理 node 驱动页面表达',
        checkpoint: '先让 builtin candidate 和 custom goal 同时存在',
        branchReason: '这些点适合拆成独立支线推进。',
        candidateBranches: ['补充复盘'],
      },
    },
    {
      id: 'branch-1',
      rootSessionId: 'main-1',
      name: 'Branch · rich view 方案',
      updatedAt: '2026-04-03T12:10:00.000Z',
      sourceContext: { parentSessionId: 'main-1' },
      taskCard: {
        goal: 'rich view 方案',
        mainGoal: '整理 node 驱动页面表达',
        checkpoint: '对比 markdown 和 html 两种 view.type',
      },
      _branchStatus: 'active',
    },
  ];

  const builtinCandidatePlan = producers.buildBranchCandidateTaskMapPlan({
    rootSessionId: 'main-1',
    sessions,
    generatedAt: '2026-04-03T12:15:00.000Z',
  });
  assert.ok(builtinCandidatePlan, 'branch-candidate producer should generate the builtin candidate overlay');

  const customGoalPlan = {
    id: 'manual-plan:main-1:goal-panel',
    rootSessionId: 'main-1',
    questId: 'quest:main-1',
    mode: 'augment-default',
    source: {
      type: 'manual',
      generatedAt: '2026-04-03T12:20:00.000Z',
    },
    nodes: [
      {
        id: 'goal-panel:main-1',
        kind: 'goal-panel',
        title: '构建 node 驱动页面表达',
        summary: '让自定义目标节点和内建支线建议并存',
        sourceSessionId: 'main-1',
        parentNodeId: 'session:main-1',
        status: 'active',
        lineRole: 'main',
        surfaceBindings: ['task-map'],
        taskCardBindings: ['mainGoal', 'summary'],
        view: {
          type: 'markdown',
          content: '## 目标\n\n让地图、输入区建议和 taskCard patch 共用 node instance。',
          width: 460,
          height: 260,
        },
      },
    ],
    edges: [],
    updatedAt: '2026-04-03T12:20:00.000Z',
  };

  const projection = context.MelodySyncTaskMapModel.buildTaskMapProjection({
    snapshot: {
      taskMapPlans: [builtinCandidatePlan, customGoalPlan],
      branchContexts: [
        {
          sessionId: 'branch-1',
          checkpointSummary: '对比 markdown 和 html 两种 view.type',
        },
      ],
    },
    sessions,
    currentSessionId: 'main-1',
    focusedSessionId: 'main-1',
  });

  const quest = projection.mainQuests[0];
  assert.ok(quest, 'task-map projection should build a quest for the current root session');

  const customGoalNode = quest.nodes.find((node) => node.id === 'goal-panel:main-1');
  const builtinCandidateNode = quest.nodes.find((node) => node.id === 'candidate:main-1:补充复盘');
  const branchNode = quest.nodes.find((node) => node.id === 'session:branch-1');

  assert.ok(customGoalNode, 'custom node plan should materialize custom nodes in the same graph as builtin kinds');
  assert.ok(builtinCandidateNode, 'builtin candidate node should still exist after plan augmentation');
  assert.ok(branchNode, 'builtin branch node should still exist after plan augmentation');
  assert.equal(customGoalNode.view?.type, 'markdown');
  assert.equal(customGoalNode.origin?.type, 'plan');
  assert.deepEqual(toPlain(customGoalNode.taskCardBindings), ['mainGoal', 'summary']);

  const backendGoalNode = backendNodeInstance.createNodeInstance(customGoalPlan.nodes[0], {
    questId: 'quest:main-1',
    origin: {
      type: 'manual',
      sourceId: customGoalPlan.id,
      planId: customGoalPlan.id,
    },
  });
  assert.deepEqual(
    backendGoalNode?.taskCardBindings,
    ['mainGoal', 'summary'],
    'backend node-instance layer should preserve custom node task-card bindings before frontend projection',
  );

  const backendTaskCardPatch = backendNodeTaskCard.buildTaskCardPatchForSourceSession(
    [
      ...builtinCandidatePlan.nodes,
      ...customGoalPlan.nodes,
    ],
    'main-1',
  );
  assert.deepEqual(
    backendTaskCardPatch,
    {
      mainGoal: '构建 node 驱动页面表达',
      summary: '让自定义目标节点和内建支线建议并存',
      candidateBranches: ['补充复盘'],
    },
    'backend node task-card layer should let builtin and custom plan nodes converge on one session-scoped patch',
  );

  const composerEntries = context.MelodySyncWorkbenchSurfaceProjection.buildComposerSuggestionEntries({
    session: sessions[0],
    projection,
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(composerEntries)),
    [
      {
        id: 'candidate:main-1:补充复盘',
        text: '补充复盘',
        summary: '这些点适合拆成独立支线推进。',
        capabilities: ['create-branch', 'dismiss'],
        sourceSessionId: 'main-1',
        taskCardBindings: ['candidateBranches'],
        origin: {
          type: 'plan',
          sourceId: 'builtin.branch-candidates',
          sourceLabel: 'branch.suggested',
          hookId: 'builtin.branch-candidates',
          planId: 'hook-plan:branch-candidates:main-1',
        },
      },
    ],
    'user flow should project builtin candidate nodes into the composer suggestion slot',
  );

  const taskCardPatch = context.MelodySyncWorkbenchNodeTaskCard.buildTaskCardPatchForSourceSession(
    quest.nodes,
    'main-1',
  );
  assert.deepEqual(
    toPlain(taskCardPatch),
    {
      mainGoal: '构建 node 驱动页面表达',
      summary: '让自定义目标节点和内建支线建议并存',
      candidateBranches: ['补充复盘'],
    },
    'user flow should let builtin and custom nodes contribute to the same session task-card patch without touching renderer code',
  );

  function makeElement(tagName = 'div') {
    return {
      tagName: String(tagName || 'div').toUpperCase(),
      hidden: false,
      className: '',
      textContent: '',
      innerHTML: '',
      children: [],
      classList: {
        add() {},
        remove() {},
        toggle() {},
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      addEventListener() {},
      setAttribute(name, value) {
        this[name] = String(value);
      },
    };
  }

  const nodeCanvasController = context.MelodySyncWorkbenchNodeCanvasUi.createController({
    railEl: makeElement('section'),
    titleEl: makeElement('div'),
    summaryEl: makeElement('div'),
    bodyEl: makeElement('div'),
    closeBtn: makeElement('button'),
    documentRef: {
      createElement(tagName) {
        return makeElement(tagName);
      },
    },
    windowRef: context.window,
  });
  assert.equal(
    nodeCanvasController.renderNode(customGoalNode),
    true,
    'user flow should let a custom rich-view node open the dedicated node canvas without changing renderer contracts',
  );

  const capabilityCalls = [];
  const nodeActionController = context.MelodySyncWorkbenchNodeCapabilities.createController({
    collapseTaskMapAfterAction() {
      capabilityCalls.push('collapse');
    },
    async enterBranchFromSession(sessionId, title, payload) {
      capabilityCalls.push({ type: 'create-branch', sessionId, title, payload });
    },
  });
  await nodeActionController.executePrimaryAction(
    builtinCandidateNode,
    {
      nodeMap: new Map(quest.nodes.map((node) => [node.id, node])),
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(capabilityCalls)),
    [
      'collapse',
      {
        type: 'create-branch',
        sessionId: 'main-1',
        title: '补充复盘',
        payload: {
          branchReason: '从「整理 node 驱动页面表达」继续拆出独立支线',
          checkpointSummary: '补充复盘',
        },
      },
    ],
    'user flow should still route builtin candidate nodes through the shared capability controller',
  );

  console.log('test-workbench-node-user-flow: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
