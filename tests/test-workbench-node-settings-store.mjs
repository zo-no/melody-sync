#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'workbench-node-settings-'));

mkdirSync(join(tempHome, '.config', 'melody-sync'), { recursive: true });
process.env.HOME = tempHome;

try {
  const storeModule = await import(
    pathToFileURL(join(repoRoot, 'chat/workbench/node-settings-store.mjs')).href
  );
  const definitionsModule = await import(
    pathToFileURL(join(repoRoot, 'chat/workbench/node-definitions.mjs')).href
  );

  await storeModule.createCustomNodeKind({
    id: 'review-note',
    label: '复盘节点',
    description: '用于表达一次阶段复盘。',
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

  let settings = await storeModule.readWorkbenchNodeSettings();
  assert.deepEqual(
    settings.customNodeKinds.map((definition) => definition.id),
    ['review-note'],
  );
  assert.equal(
    definitionsModule.createWorkbenchNodeDefinitionsPayload().nodeKinds.includes('review-note'),
    true,
    'custom node kinds should be exposed by the canonical workbench payload',
  );
  assert.deepEqual(
    settings.customNodeKinds[0]?.composition?.allowedParentKinds,
    ['main', 'review-note'],
  );
  assert.equal(
    definitionsModule.createWorkbenchNodeDefinitionsPayload()
      .nodeKindDefinitions
      .find((definition) => definition.id === 'review-note')?.composition?.defaultEdgeType,
    'completion',
    'custom node kinds should preserve composition metadata in the canonical payload',
  );

  await storeModule.updateCustomNodeKind('review-note', {
    label: '阶段复盘',
    description: '用于表达一次阶段性复盘。',
    lane: 'branch',
    role: 'action',
    mergePolicy: 'replace-latest',
    composition: {
      canBeRoot: false,
      allowedParentKinds: ['main', 'branch'],
      allowedChildKinds: [],
      requiresSourceSession: true,
      defaultInteraction: 'create-branch',
      defaultEdgeType: 'suggestion',
      layoutVariant: 'compact',
      countsAs: {
        sessionNode: false,
        branch: false,
        candidate: true,
        completedSummary: false,
      },
    },
  });

  settings = await storeModule.readWorkbenchNodeSettings();
  assert.equal(settings.customNodeKinds[0]?.label, '阶段复盘');
  assert.equal(settings.customNodeKinds[0]?.lane, 'branch');
  assert.equal(settings.customNodeKinds[0]?.role, 'action');
  assert.equal(settings.customNodeKinds[0]?.mergePolicy, 'replace-latest');
  assert.equal(settings.customNodeKinds[0]?.composition?.defaultInteraction, 'create-branch');
  assert.equal(settings.customNodeKinds[0]?.composition?.countsAs?.candidate, true);

  await storeModule.deleteCustomNodeKind('review-note');

  settings = await storeModule.readWorkbenchNodeSettings();
  assert.deepEqual(settings.customNodeKinds, []);
  assert.equal(
    definitionsModule.createWorkbenchNodeDefinitionsPayload().nodeKinds.includes('review-note'),
    false,
    'deleted custom node kinds should be removed from the canonical workbench payload',
  );

  console.log('test-workbench-node-settings-store: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
