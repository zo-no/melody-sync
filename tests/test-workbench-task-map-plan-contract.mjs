#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'workbench-task-map-plan-contract-'));

mkdirSync(join(tempHome, '.config', 'melody-sync'), { recursive: true });
process.env.HOME = tempHome;

try {
  const nodeSettingsStore = await import(
    pathToFileURL(join(repoRoot, 'chat/workbench/node-settings-store.mjs')).href
  );
  const contractModule = await import(
    pathToFileURL(join(repoRoot, 'chat/workbench/task-map-plan-contract.mjs')).href
  );

  await nodeSettingsStore.createCustomNodeKind({
    id: 'review-note',
    label: '复盘节点',
    description: '用于表达阶段复盘。',
    lane: 'side',
    role: 'summary',
    mergePolicy: 'append',
  });

  const payload = contractModule.createTaskMapPlanContractPayload();
  assert.deepEqual(payload.planModes, ['replace-default', 'augment-default']);
  assert.deepEqual(payload.edgeTypes, ['structural', 'suggestion', 'completion', 'merge']);
  assert.deepEqual(payload.sourceTypes, ['manual', 'system', 'hook']);
  assert.deepEqual(payload.viewTypes, ['flow-node', 'markdown', 'html', 'iframe']);
  assert.deepEqual(payload.surfaceSlots, ['task-map', 'composer-suggestions']);
  assert.deepEqual(payload.capabilities, ['open-session', 'create-branch', 'dismiss']);
  assert.deepEqual(payload.taskCardBindingKeys, ['mainGoal', 'goal', 'candidateBranches', 'summary', 'checkpoint', 'nextSteps']);
  assert.equal(payload.fallbackProjection, 'continuity');
  assert.equal(payload.settings?.supportsHookGeneratedPlans, true);
  assert.equal(payload.settings?.supportsSessionScopedPlanWriteApi, true);
  assert.equal(payload.settings?.supportsSessionScopedGraphReadApi, true);
  assert.equal(payload.settings?.supportsRichCanvasViews, true);
  assert.equal(
    payload.nodeKindDefinitions.some((definition) => definition.id === 'review-note'),
    true,
    'task-map-plan contract should include custom node kinds so future producers can compose against the full current catalog',
  );
  assert.deepEqual(
    payload.planCapableHooks.map((hook) => hook.id),
    ['builtin.branch-candidates'],
    'task-map-plan contract should currently expose only the whitelisted plan-capable hooks',
  );
  assert.equal(payload.planCapableHooks[0]?.taskMapPlanPolicy, 'augment-default');
  assert.equal(payload.planCapableHooks[0]?.eventPattern, 'branch.suggested');

  console.log('test-workbench-task-map-plan-contract: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
