#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const source = readFileSync(
  join(repoRoot, 'static', 'frontend', 'settings', 'nodes', 'model.js'),
  'utf8',
);

const context = { console };
context.globalThis = context;
context.window = context;
vm.runInNewContext(source, context, { filename: 'settings/nodes/model.js' });

const model = context.MelodySyncTaskMapNodeSettingsModel;
assert.ok(model, 'node settings model should be exposed on globalThis');

const normalized = model.normalizeNodeDefinitionsPayload({
  nodeKindDefinitions: [
    {
      id: 'review-note',
      label: '复盘节点',
      description: '用于阶段复盘。',
      lane: 'side',
      role: 'summary',
      mergePolicy: 'append',
      builtIn: false,
      editable: true,
      source: 'custom',
      composition: {
        canBeRoot: false,
        allowedParentKinds: ['main', 'review-note'],
        allowedChildKinds: [],
        requiresSourceSession: true,
        defaultInteraction: 'none',
        defaultEdgeType: 'completion',
        layoutVariant: 'compact',
        taskCardBindings: ['summary'],
        countsAs: {
          sessionNode: false,
          branch: false,
          candidate: false,
          completedSummary: true,
        },
      },
    },
  ],
});

assert.deepEqual(
  JSON.parse(JSON.stringify(normalized.customNodeKinds[0]?.composition?.allowedParentKinds)),
  ['main', 'review-note'],
);
assert.equal(normalized.customNodeKinds[0]?.composition?.defaultEdgeType, 'completion');
assert.deepEqual(
  JSON.parse(JSON.stringify(normalized.customNodeKinds[0]?.composition?.taskCardBindings)),
  ['summary'],
);
assert.equal(normalized.customNodeKinds[0]?.composition?.countsAs?.completedSummary, true);

console.log('test-workbench-node-settings-model: ok');
