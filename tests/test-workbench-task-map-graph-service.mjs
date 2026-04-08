#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'workbench-task-map-graph-service-'));

mkdirSync(join(tempHome, '.config', 'melody-sync'), { recursive: true });
process.env.HOME = tempHome;

try {
  const sessionManager = await import(
    pathToFileURL(join(repoRoot, 'backend/session/manager.mjs')).href
  );
  const nodeSettingsStore = await import(
    pathToFileURL(join(repoRoot, 'backend/workbench/node-settings-store.mjs')).href
  );
  const taskMapPlanService = await import(
    pathToFileURL(join(repoRoot, 'backend/workbench/task-map-plan-service.mjs')).href
  );
  const taskMapGraphService = await import(
    pathToFileURL(join(repoRoot, 'backend/workbench/task-map-graph-service.mjs')).href
  );

  await nodeSettingsStore.createCustomNodeKind({
    id: 'goal-panel',
    label: '目标节点',
    description: '在图上表达当前阶段目标。',
    lane: 'main',
    role: 'summary',
    mergePolicy: 'replace-latest',
    composition: {
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
        completedSummary: true,
      },
    },
  });

  const mainSession = await sessionManager.createSession(tempHome, 'codex', '整理 node 架构', {});
  await sessionManager.updateSessionTaskCard(mainSession.id, {
    goal: '整理 node 架构',
    mainGoal: '默认主任务',
    summary: '默认摘要',
    candidateBranches: ['补充复盘'],
  });

  const branchSession = await sessionManager.createSession(tempHome, 'codex', 'Branch · rich view 方案', {
    rootSessionId: mainSession.id,
    sourceContext: { parentSessionId: mainSession.id },
  });
  await sessionManager.updateSessionTaskCard(branchSession.id, {
    goal: 'rich view 方案',
    mainGoal: '整理 node 架构',
    summary: '比较 markdown 和 html 两种 view.type',
  });

  await taskMapPlanService.saveTaskMapPlanForSession(mainSession.id, {
    id: 'manual-plan:goal-panel',
    mode: 'augment-default',
    source: { type: 'manual' },
    nodes: [
      {
        id: `goal-panel:${mainSession.id}`,
        kind: 'goal-panel',
        title: '构建 node 驱动页面表达',
        summary: '让自定义目标节点和内建 candidate 共存',
        sourceSessionId: mainSession.id,
        parentNodeId: `session:${mainSession.id}`,
        status: 'active',
        lineRole: 'main',
        surfaceBindings: ['task-map'],
        taskCardBindings: ['mainGoal', 'summary'],
        view: {
          type: 'markdown',
          content: '## 目标',
        },
      },
      {
        id: `candidate:${mainSession.id}:补充复盘`,
        kind: 'candidate',
        title: '补充复盘',
        summary: '适合拆成独立支线继续推进',
        sourceSessionId: mainSession.id,
        parentNodeId: `session:${mainSession.id}`,
        status: 'candidate',
        lineRole: 'candidate',
        surfaceBindings: ['task-map', 'composer-suggestions'],
        taskCardBindings: ['candidateBranches'],
      },
    ],
    edges: [
      {
        from: `session:${mainSession.id}`,
        to: `candidate:${mainSession.id}:补充复盘`,
        type: 'suggestion',
      },
    ],
  });

  const result = await taskMapGraphService.getTaskMapGraphForSession(branchSession.id);
  assert.equal(result.rootSessionId, mainSession.id);
  assert.equal(result.taskMapGraph?.rootSessionId, mainSession.id);
  assert.equal(
    result.taskMapGraph?.currentNodeId,
    `session:${branchSession.id}`,
    'graph reads from a branch session should resolve the same quest and keep the branch node active',
  );

  const nodeById = new Map((result.taskMapGraph?.nodes || []).map((node) => [node.id, node]));
  const edgeById = new Map((result.taskMapGraph?.edges || []).map((edge) => [edge.id, edge]));

  assert.ok(nodeById.has(`session:${mainSession.id}`), 'canonical graph should keep the builtin main node');
  assert.ok(nodeById.has(`session:${branchSession.id}`), 'canonical graph should keep the builtin branch node');
  assert.ok(nodeById.has(`candidate:${mainSession.id}:补充复盘`), 'canonical graph should include candidate nodes in the same quest graph as builtin branch and custom goal nodes');
  assert.ok(nodeById.has(`goal-panel:${mainSession.id}`), 'canonical graph should include custom nodes from manual task-map plans');

  assert.equal(nodeById.get(`goal-panel:${mainSession.id}`)?.view?.type, 'markdown');
  assert.equal(nodeById.get(`goal-panel:${mainSession.id}`)?.origin?.type, 'plan');
  assert.deepEqual(
    nodeById.get(`goal-panel:${mainSession.id}`)?.taskCardBindings,
    ['mainGoal', 'summary'],
    'custom graph nodes should keep task-card binding metadata in the canonical graph',
  );

  assert.equal(
    edgeById.get(`edge:session:${mainSession.id}:candidate:${mainSession.id}:补充复盘`)?.type,
    'suggestion',
    'candidate nodes should keep suggestion edge semantics in the canonical graph',
  );
  assert.equal(
    edgeById.get(`edge:session:${mainSession.id}:goal-panel:${mainSession.id}`)?.type,
    'completion',
    'custom goal nodes should inherit their default completion edge semantics in the canonical graph',
  );
  assert.equal(result.taskMapGraph?.counts?.candidateBranches, 1);
  assert.equal(result.taskMapGraph?.counts?.activeBranches, 1);

  console.log('test-workbench-task-map-graph-service: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
