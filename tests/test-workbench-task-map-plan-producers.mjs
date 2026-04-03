#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const tempHome = mkdtempSync(join(tmpdir(), 'workbench-task-map-plan-producers-'));
mkdirSync(join(tempHome, '.config', 'melody-sync'), { recursive: true });
process.env.HOME = tempHome;

try {
  const producers = await import(
    pathToFileURL(join(repoRoot, 'chat/workbench/task-map-plan-producers.mjs')).href
  );
  const taskMapPlans = await import(
    pathToFileURL(join(repoRoot, 'chat/workbench/task-map-plans.mjs')).href
  );

  const sessions = [
    {
      id: 'main-1',
      rootSessionId: 'main-1',
      name: '整理 hooks + node',
      taskCard: {
        goal: '整理 hooks + node',
        branchReason: '这些点适合拆成独立支线，不要继续污染主线。',
        candidateBranches: ['补充复盘', '视觉风格线'],
      },
    },
    {
      id: 'branch-visual',
      rootSessionId: 'main-1',
      name: 'Branch · 视觉风格线',
      sourceContext: {
        parentSessionId: 'main-1',
      },
      taskCard: {
        goal: '视觉风格线',
        candidateBranches: ['镜头语言专题'],
      },
    },
  ];

  const builtPlan = producers.buildBranchCandidateTaskMapPlan({
    rootSessionId: 'main-1',
    sessions,
    generatedAt: '2026-04-03T10:00:00.000Z',
  });

  assert.ok(builtPlan, 'producer should build a hook-generated plan when quest sessions contain candidate branches');
  assert.equal(builtPlan.mode, 'augment-default');
  assert.equal(builtPlan.source?.hookId, 'builtin.branch-candidates');
  assert.deepEqual(
    builtPlan.nodes.map((node) => node.id),
    [
      'candidate:main-1:补充复盘',
      'candidate:branch-visual:镜头语言专题',
    ],
    'producer should skip candidates already materialized as direct child branch sessions and keep per-session candidate overlays',
  );
  assert.deepEqual(
    builtPlan.nodes[0].surfaceBindings,
    ['task-map', 'composer-suggestions'],
    'producer should carry candidate node surface bindings into the hook-generated plan',
  );
  assert.deepEqual(
    builtPlan.nodes[0].taskCardBindings,
    ['candidateBranches'],
    'producer should carry candidate node task-card bindings into the hook-generated plan',
  );

  const taskCardWrites = [];
  const persisted = await producers.syncBranchCandidateTaskMapPlan({
    session: sessions[0],
    sessions,
    nowIso: () => '2026-04-03T10:00:00.000Z',
    updateSessionTaskCard: async (sessionId, nextTaskCard) => {
      taskCardWrites.push({ sessionId, nextTaskCard });
      return { id: sessionId, taskCard: nextTaskCard };
    },
  });
  const persistedHookPlan = persisted.find((plan) => plan.source?.hookId === 'builtin.branch-candidates');
  assert.ok(persistedHookPlan, 'sync should persist the hook-generated branch-candidate plan');
  assert.equal(persistedHookPlan.nodes.length, 2);
  assert.deepEqual(
    taskCardWrites.map((entry) => ({
      sessionId: entry.sessionId,
      candidateBranches: entry.nextTaskCard?.candidateBranches || [],
    })),
    [
      {
        sessionId: 'main-1',
        candidateBranches: ['补充复盘'],
      },
    ],
    'sync should write back hook-generated candidate nodes into task cards when the managed candidate list changes',
  );

  sessions[0] = {
    ...sessions[0],
    suppressedBranchTitles: ['补充复盘'],
    taskCard: {
      ...sessions[0].taskCard,
      candidateBranches: ['补充复盘'],
    },
  };
  sessions[1] = {
    ...sessions[1],
    taskCard: {
      ...sessions[1].taskCard,
      candidateBranches: [],
    },
  };

  const resynced = await producers.syncBranchCandidateTaskMapPlan({
    session: sessions[0],
    sessions,
    nowIso: () => '2026-04-03T10:05:00.000Z',
  });
  assert.equal(
    resynced.some((plan) => plan.source?.hookId === 'builtin.branch-candidates'),
    false,
    'sync should remove the hook-generated plan when all candidate overlays are suppressed or consumed',
  );

  const reloadedPlans = await taskMapPlans.readTaskMapPlans();
  assert.equal(
    reloadedPlans.some((plan) => plan.source?.hookId === 'builtin.branch-candidates'),
    false,
    'task-map plan producer should round-trip plan removal through persistence',
  );

  console.log('test-workbench-task-map-plan-producers: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
