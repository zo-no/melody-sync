#!/usr/bin/env node
import assert from 'assert/strict';

import {
  applyTaskMapLayoutOverrides,
  createTaskMapLayoutStorageKey,
  filterTaskMapLayoutPositions,
  readTaskMapLayoutPositions,
  writeTaskMapLayoutPositions,
} from '../frontend-src/workbench/task-map-layout-persistence.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const storageKey = createTaskMapLayoutStorageKey({
  rootSessionId: ' main-1 ',
  questId: 'quest:ignored',
});
assert.equal(storageKey, 'melodysync.task-map-layout.v1:main-1');

const storage = createStorage({
  [storageKey]: JSON.stringify({
    version: 1,
    positions: {
      ' session:main-1 ': { x: 140.25, y: '200' },
      invalid: { x: 'nope', y: 12 },
    },
  }),
});

assert.deepEqual(
  readTaskMapLayoutPositions(storage, storageKey),
  {
    'session:main-1': { x: 140.25, y: 200 },
  },
  'reading should normalize valid coordinates and ignore malformed entries',
);

assert.deepEqual(
  filterTaskMapLayoutPositions(
    {
      'session:main-1': { x: 10, y: 20 },
      'session:branch-1': { x: 90.5, y: 132.75 },
    },
    ['session:branch-1'],
  ),
  {
    'session:branch-1': { x: 90.5, y: 132.75 },
  },
  'filtering should prune stale node ids before persistence',
);

const baseNodes = [
  { id: 'session:main-1', position: { x: 0, y: 0 }, data: { rawTitle: '主线' } },
  { id: 'session:branch-1', position: { x: 12, y: 18 }, data: { rawTitle: '支线' } },
];
const overriddenNodes = applyTaskMapLayoutOverrides(baseNodes, {
  'session:branch-1': { x: 90.5, y: 132.75 },
});
assert.equal(overriddenNodes[0], baseNodes[0], 'nodes without overrides should remain referentially stable');
assert.notEqual(overriddenNodes[1], baseNodes[1], 'overridden nodes should be cloned so React can observe position changes');
assert.deepEqual(
  overriddenNodes[1].position,
  { x: 90.5, y: 132.75 },
  'matching node ids should adopt the persisted coordinates',
);

assert.equal(
  writeTaskMapLayoutPositions(storage, storageKey, {
    'session:branch-1': { x: 90.5, y: 132.75 },
    broken: { x: 'oops', y: 1 },
  }),
  true,
  'writing valid layout positions should succeed',
);
assert.deepEqual(
  readTaskMapLayoutPositions(storage, storageKey),
  {
    'session:branch-1': { x: 90.5, y: 132.75 },
  },
  'writing should round-trip the normalized position payload',
);

assert.equal(
  writeTaskMapLayoutPositions(storage, storageKey, {}),
  true,
  'writing an empty layout should still succeed by clearing the storage entry',
);
assert.equal(storage.getItem(storageKey), null, 'empty layout writes should remove the persisted entry');

console.log('test-workbench-task-map-layout-persistence: ok');
