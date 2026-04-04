#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'workbench-task-map-plan-service-'));

mkdirSync(join(tempHome, '.config', 'melody-sync'), { recursive: true });
process.env.HOME = tempHome;

try {
  const sessionManager = await import(
    pathToFileURL(join(repoRoot, 'backend/session-manager.mjs')).href
  );
  const nodeSettingsStore = await import(
    pathToFileURL(join(repoRoot, 'backend/workbench/node-settings-store.mjs')).href
  );
  const taskMapPlanService = await import(
    pathToFileURL(join(repoRoot, 'backend/workbench/task-map-plan-service.mjs')).href
  );

  await nodeSettingsStore.createCustomNodeKind({
    id: 'goal-panel',
    label: '目标节点',
    description: '用于表达当前阶段目标。',
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
    candidateBranches: ['旧候选'],
  });

  const branchSession = await sessionManager.createSession(tempHome, 'codex', 'Branch · plan service', {
    rootSessionId: mainSession.id,
    sourceContext: { parentSessionId: mainSession.id },
  });
  await sessionManager.updateSessionTaskCard(branchSession.id, {
    goal: '分支任务',
    mainGoal: '整理 node 架构',
    candidateBranches: ['旧分支候选'],
  });

  const saved = await taskMapPlanService.saveTaskMapPlanForSession(branchSession.id, {
    id: 'manual-plan:node-goal',
    mode: 'augment-default',
    source: {
      type: 'manual',
    },
    nodes: [
      {
        id: `goal-panel:${mainSession.id}`,
        kind: 'goal-panel',
        title: '构建 node 驱动页面表达',
        summary: '让自定义目标节点和内建支线建议共存',
        sourceSessionId: mainSession.id,
        parentNodeId: `session:${mainSession.id}`,
        status: 'active',
        lineRole: 'main',
        taskCardBindings: ['mainGoal', 'summary'],
        surfaceBindings: ['task-map'],
        view: {
          type: 'markdown',
          content: '## 目标',
        },
      },
      {
        id: `candidate:${mainSession.id}:补充复盘`,
        kind: 'candidate',
        title: '补充复盘',
        summary: '适合拆成独立支线继续处理',
        sourceSessionId: mainSession.id,
        parentNodeId: `session:${mainSession.id}`,
        status: 'candidate',
        lineRole: 'candidate',
        taskCardBindings: ['candidateBranches'],
        surfaceBindings: ['task-map', 'composer-suggestions'],
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

  assert.equal(saved.rootSessionId, mainSession.id);
  assert.equal(saved.taskMapPlan?.id, 'manual-plan:node-goal');
  assert.equal(saved.taskMapPlans.length, 1, 'session-scoped save should persist the root quest plan set');

  const listedFromMain = await taskMapPlanService.listTaskMapPlansForSession(mainSession.id);
  const listedFromBranch = await taskMapPlanService.listTaskMapPlansForSession(branchSession.id);
  assert.deepEqual(
    listedFromMain.taskMapPlans.map((plan) => plan.id),
    ['manual-plan:node-goal'],
    'listing from the root session should include the saved manual plan',
  );
  assert.deepEqual(
    listedFromBranch.taskMapPlans.map((plan) => plan.id),
    ['manual-plan:node-goal'],
    'listing from a branch session should resolve back to the same root plan set',
  );

  const reloadedMain = await sessionManager.getSession(mainSession.id);
  assert.deepEqual(
    reloadedMain?.taskCard?.candidateBranches,
    ['补充复盘'],
    'saving a plan should sync managed candidate bindings back into the root session task card',
  );
  assert.equal(
    reloadedMain?.taskCard?.mainGoal,
    '构建 node 驱动页面表达',
    'saving a plan should let custom plan nodes override root scalar task-card bindings',
  );
  assert.equal(
    reloadedMain?.taskCard?.summary,
    '让自定义目标节点和内建支线建议共存',
    'saving a plan should sync custom node summary bindings back into the root session task card',
  );

  await assert.rejects(
    () => taskMapPlanService.saveTaskMapPlanForSession(mainSession.id, {
      id: 'hook-plan:not-allowed',
      source: {
        type: 'hook',
        hookId: 'builtin.branch-candidates',
      },
      nodes: [
        {
          id: `candidate:${mainSession.id}:禁止`,
          kind: 'candidate',
          title: '禁止通过 API 直接写 hook 计划',
          sourceSessionId: mainSession.id,
        },
      ],
    }),
    /Only manual or system task-map plans can be written through this API/,
    'formal plan write service should reject hook-sourced writes',
  );

  const deleted = await taskMapPlanService.deleteTaskMapPlanForSession(mainSession.id, 'manual-plan:node-goal');
  assert.equal(deleted.deletedPlanId, 'manual-plan:node-goal');
  assert.equal(deleted.taskMapPlans.length, 0, 'deleting a plan should remove it from the root-scoped list');

  const afterDelete = await sessionManager.getSession(mainSession.id);
  assert.deepEqual(
    afterDelete?.taskCard?.candidateBranches,
    [],
    'deleting the plan should clear managed array bindings that disappeared from the plan set',
  );
  assert.equal(
    afterDelete?.taskCard?.mainGoal,
    '构建 node 驱动页面表达',
    'deleting the plan should conservatively keep scalar bindings until an explicit replacement arrives',
  );

  console.log('test-workbench-task-map-plan-service: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
