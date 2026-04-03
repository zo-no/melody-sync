#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'workbench-task-map-plans-'));

mkdirSync(join(tempHome, '.config', 'melody-sync'), { recursive: true });
process.env.HOME = tempHome;

try {
  const nodeSettingsStore = await import(
    pathToFileURL(join(repoRoot, 'chat/workbench/node-settings-store.mjs')).href
  );
  const taskMapPlansModule = await import(
    pathToFileURL(join(repoRoot, 'chat/workbench/task-map-plans.mjs')).href
  );

  await nodeSettingsStore.createCustomNodeKind({
    id: 'review-note',
    label: '复盘节点',
    description: '用于表达阶段复盘。',
    lane: 'side',
    role: 'summary',
    mergePolicy: 'append',
    composition: {
      canBeRoot: false,
      allowedParentKinds: ['main', 'review-note'],
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
  });

  const persistedPlans = await taskMapPlansModule.persistTaskMapPlans([
    {
      rootSessionId: 'main-1',
      mode: 'augment-default',
      title: 'AI 地图增强',
      nodes: [
        {
          id: 'session:main-1',
          kind: 'main',
          title: '主任务',
          sessionId: 'main-1',
          sourceSessionId: 'main-1',
          status: 'active',
        },
        {
          id: 'review:main-1:summary',
          kind: 'review-note',
          title: '阶段复盘',
          sourceSessionId: 'main-1',
          parentNodeId: 'session:main-1',
          status: 'done',
        },
        {
          id: 'invalid:main-1',
          kind: 'missing-kind',
          title: '无效节点',
          sourceSessionId: 'main-1',
          parentNodeId: 'session:main-1',
          status: 'active',
        },
      ],
      edges: [
        {
          from: 'session:main-1',
          to: 'review:main-1:summary',
          type: 'completion',
        },
        {
          from: 'session:main-1',
          to: 'invalid:main-1',
          type: 'structural',
        },
      ],
    },
    {
      rootSessionId: 'main-2',
      mode: 'replace-default',
      source: {
        type: 'hook',
        hookId: 'builtin.branch-candidates',
        event: 'branch.suggested',
        generatedAt: '2026-04-03T09:00:00.000Z',
      },
      nodes: [
        {
          id: 'session:main-2',
          kind: 'main',
          title: '主任务 2',
          sessionId: 'main-2',
          sourceSessionId: 'main-2',
          status: 'active',
        },
      ],
    },
    {
      rootSessionId: 'main-3',
      source: {
        type: 'hook',
        hookId: 'builtin.push-notification',
        event: 'run.completed',
      },
      nodes: [
        {
          id: 'session:main-3',
          kind: 'main',
          title: '不应保留的通知图',
          sessionId: 'main-3',
          sourceSessionId: 'main-3',
          status: 'active',
        },
      ],
    },
  ]);

  assert.equal(persistedPlans.length, 2, 'persisted plan store should keep valid plans and reject unsupported hook producers');
  assert.deepEqual(
    persistedPlans[0].nodes.map((node) => node.id),
    ['session:main-1', 'review:main-1:summary'],
  );
  assert.equal(
    persistedPlans[0].nodes.find((node) => node.id === 'review:main-1:summary')?.kind,
    'review-note',
    'task map plan store should preserve custom node kinds that are known in the node catalog',
  );
  assert.deepEqual(
    persistedPlans[0].edges.map((edge) => edge.toNodeId),
    ['review:main-1:summary'],
  );
  assert.equal(persistedPlans[1].source?.type, 'hook');
  assert.equal(persistedPlans[1].source?.hookId, 'builtin.branch-candidates');
  assert.equal(persistedPlans[1].source?.taskMapPlanPolicy, 'augment-default');
  assert.equal(
    persistedPlans[1].mode,
    'augment-default',
    'hook-produced task map plans should be constrained by the hook policy instead of arbitrary requested mode',
  );

  const reloadedPlans = await taskMapPlansModule.readTaskMapPlans();
  assert.deepEqual(
    JSON.parse(JSON.stringify(reloadedPlans)),
    JSON.parse(JSON.stringify(persistedPlans)),
    'task map plan store should round-trip normalized plans through file persistence',
  );

  assert.equal(
    taskMapPlansModule.normalizeTaskMapPlan({
      rootSessionId: 'main-2',
      nodes: [{ id: 'bad:node', kind: 'unknown-kind' }],
    }),
    null,
    'task map plan normalization should reject plans that only reference unknown node kinds',
  );

  console.log('test-workbench-task-map-plans: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
