#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const source = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench', 'task-map-clusters.js'),
  'utf8',
);

const context = { console };
context.globalThis = context;
context.window = context;

vm.runInNewContext(source, context, { filename: 'workbench/task-map-clusters.js' });

const api = context.MelodySyncTaskMapClusters;
assert.ok(api, 'task map clusters api should be exposed on globalThis');
assert.equal(typeof api.getClusterList, 'function');
assert.equal(typeof api.getBranchCurrentLineageSessionIds, 'function');

const mainSession = {
  id: 'main-2',
  name: '整理写作计划',
  updatedAt: '2026-04-03T10:00:00.000Z',
  taskCard: {
    goal: '整理写作计划',
    checkpoint: '先拆出提纲和素材',
  },
};

const branchSession = {
  id: 'branch-2',
  name: 'Branch · 提纲拆解',
  updatedAt: '2026-04-03T10:10:00.000Z',
  sourceContext: { parentSessionId: 'main-2' },
  taskCard: {
    goal: '提纲拆解',
    mainGoal: '整理写作计划',
    lineRole: 'branch',
    checkpoint: '先把章节结构列出来',
  },
};

const nestedBranchSession = {
  id: 'branch-2-1',
  name: 'Branch · 第一章',
  updatedAt: '2026-04-03T10:20:00.000Z',
  sourceContext: { parentSessionId: 'branch-2' },
  taskCard: {
    goal: '第一章',
    mainGoal: '整理写作计划',
    lineRole: 'branch',
  },
};

const clusters = api.getClusterList(
  { taskClusters: [] },
  [mainSession, branchSession, nestedBranchSession],
);

assert.equal(clusters.length, 1, 'cluster helper should synthesize a main cluster when no workbench cluster exists yet');
assert.equal(clusters[0].mainSessionId, 'main-2');
assert.deepEqual(
  JSON.parse(JSON.stringify(clusters[0].branchSessions.map((session) => ({
    id: session.id,
    parent: session._branchParentSessionId,
    depth: session._branchDepth,
    status: session._branchStatus,
  })))),
  [
    { id: 'branch-2', parent: 'main-2', depth: 1, status: 'active' },
    { id: 'branch-2-1', parent: 'branch-2', depth: 2, status: 'active' },
  ],
  'cluster helper should preserve synthetic branch lineage metadata for the default projection source',
);

const lineageIds = api.getBranchCurrentLineageSessionIds(
  {
    mainSessionId: 'main-2',
    branchSessions: clusters[0].branchSessions,
  },
  'branch-2-1',
);

assert.deepEqual(
  JSON.parse(JSON.stringify([...lineageIds])),
  ['branch-2-1', 'branch-2'],
  'cluster helper should return the current branch lineage from leaf to root branch',
);

console.log('test-workbench-task-map-clusters: ok');
