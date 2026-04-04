#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'workbench-task-map-surface-service-'));

mkdirSync(join(tempHome, '.config', 'melody-sync'), { recursive: true });
process.env.HOME = tempHome;

try {
  const sessionManager = await import(
    pathToFileURL(join(repoRoot, 'backend/session-manager.mjs')).href
  );
  const taskMapPlanService = await import(
    pathToFileURL(join(repoRoot, 'backend/workbench/task-map-plan-service.mjs')).href
  );
  const taskMapSurfaceService = await import(
    pathToFileURL(join(repoRoot, 'backend/workbench/task-map-surface-service.mjs')).href
  );

  const mainSession = await sessionManager.createSession(tempHome, 'codex', '整理 node 架构', {});
  const branchSession = await sessionManager.createSession(tempHome, 'codex', 'Branch · graph', {
    rootSessionId: mainSession.id,
    sourceContext: { parentSessionId: mainSession.id },
  });

  await taskMapPlanService.saveTaskMapPlanForSession(mainSession.id, {
    id: 'manual-plan:composer-suggestions',
    mode: 'augment-default',
    source: { type: 'manual' },
    nodes: [
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
      {
        id: `candidate:${branchSession.id}:分支复盘`,
        kind: 'candidate',
        title: '分支复盘',
        summary: '只应该出现在分支自己的输入区',
        sourceSessionId: branchSession.id,
        parentNodeId: `session:${branchSession.id}`,
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
      {
        from: `session:${branchSession.id}`,
        to: `candidate:${branchSession.id}:分支复盘`,
        type: 'suggestion',
      },
    ],
  });

  const rootSurface = await taskMapSurfaceService.getTaskMapSurfaceForSession(mainSession.id, 'composer-suggestions');
  assert.equal(rootSurface.rootSessionId, mainSession.id);
  assert.equal(rootSurface.surfaceSlot, 'composer-suggestions');
  assert.deepEqual(
    rootSurface.entries,
    [
      {
        id: `candidate:${mainSession.id}:补充复盘`,
        text: '补充复盘',
        summary: '适合拆成独立支线继续推进',
        capabilities: ['create-branch', 'dismiss'],
        sourceSessionId: mainSession.id,
        taskCardBindings: ['candidateBranches'],
        origin: {
          type: 'plan',
          sourceId: 'manual',
          sourceLabel: '',
          hookId: '',
          planId: 'manual-plan:composer-suggestions',
        },
      },
    ],
    'surface service should project only root-owned composer suggestions for the current session',
  );

  const branchSurface = await taskMapSurfaceService.getTaskMapSurfaceForSession(branchSession.id, 'composer-suggestions');
  assert.deepEqual(
    branchSurface.entries,
    [
      {
        id: `candidate:${branchSession.id}:分支复盘`,
        text: '分支复盘',
        summary: '只应该出现在分支自己的输入区',
        capabilities: ['create-branch', 'dismiss'],
        sourceSessionId: branchSession.id,
        taskCardBindings: ['candidateBranches'],
        origin: {
          type: 'plan',
          sourceId: 'manual',
          sourceLabel: '',
          hookId: '',
          planId: 'manual-plan:composer-suggestions',
        },
      },
    ],
    'surface service should scope composer suggestions to the requested session source id within the same root graph',
  );

  console.log('test-workbench-task-map-surface-service: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
