#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

function readWorkbenchFrontendSource(filename) {
  const candidates = [
    join(repoRoot, 'frontend-src', 'workbench', filename),
    join(repoRoot, 'static', 'frontend', 'workbench', filename),
  ];
  const targetPath = candidates.find((candidate) => existsSync(candidate));
  if (!targetPath) {
    throw new Error(`Workbench frontend source not found for ${filename}`);
  }
  return readFileSync(targetPath, 'utf8');
}

const taskRunStatusSource = readWorkbenchFrontendSource('task-run-status.js');
const source = readWorkbenchFrontendSource('task-map-clusters.js');

const context = { console };
context.globalThis = context;
context.window = context;

vm.runInNewContext(taskRunStatusSource, context, { filename: 'workbench/task-run-status.js' });
vm.runInNewContext(source, context, { filename: 'workbench/task-map-clusters.js' });

const api = context.MelodySyncTaskMapClusters;
assert.ok(api, 'task map clusters api should be exposed on globalThis');
assert.equal(typeof api.getClusterList, 'function');
assert.equal(typeof api.getBranchCurrentLineageSessionIds, 'function');

const mainSession = {
  id: 'main-2',
  name: '整理写作计划',
  updatedAt: '2026-04-03T10:00:00.000Z',
  sessionState: {
    goal: '整理写作计划',
    mainGoal: '整理写作计划',
    checkpoint: '先拆出提纲和素材',
    lineRole: 'main',
  },
};

const branchSession = {
  id: 'branch-2',
  name: 'Branch · 提纲拆解',
  updatedAt: '2026-04-03T10:10:00.000Z',
  sourceContext: { parentSessionId: 'main-2' },
  sessionState: {
    goal: '提纲拆解',
    mainGoal: '整理写作计划',
    lineRole: 'branch',
    branchFrom: '整理写作计划',
    checkpoint: '先把章节结构列出来',
  },
};

const nestedBranchSession = {
  id: 'branch-2-1',
  name: 'Branch · 第一章',
  updatedAt: '2026-04-03T10:20:00.000Z',
  sourceContext: { parentSessionId: 'branch-2' },
  sessionState: {
    goal: '第一章',
    mainGoal: '整理写作计划',
    lineRole: 'branch',
  },
};

const finishedBranchSession = {
  id: 'branch-done',
  name: 'Branch · 已完成支线',
  updatedAt: '2026-04-03T10:30:00.000Z',
  workflowState: 'done',
  sourceContext: { parentSessionId: 'main-2' },
  sessionState: {
    goal: '已完成支线',
    mainGoal: '整理写作计划',
    lineRole: 'branch',
  },
};

const inboxBranchSession = {
  id: 'branch-inbox',
  name: 'Branch · 收集箱任务',
  updatedAt: '2026-04-03T10:05:00.000Z',
  sourceContext: { parentSessionId: 'main-2' },
  sessionState: {
    goal: '收集箱任务',
    mainGoal: '整理写作计划',
    lineRole: 'branch',
  },
  taskPoolMembership: {
    longTerm: {
      role: 'member',
      projectSessionId: 'main-2',
      bucket: 'inbox',
    },
  },
};

const scheduledBranchSession = {
  id: 'branch-short',
  name: 'Branch · 短期任务',
  updatedAt: '2026-04-03T10:01:00.000Z',
  sourceContext: { parentSessionId: 'main-2' },
  sessionState: {
    goal: '短期任务',
    mainGoal: '整理写作计划',
    lineRole: 'branch',
  },
  taskPoolMembership: {
    longTerm: {
      role: 'member',
      projectSessionId: 'main-2',
      bucket: 'short_term',
    },
  },
};

const clusters = api.getClusterList(
  { taskClusters: [] },
  [mainSession, inboxBranchSession, scheduledBranchSession, branchSession, nestedBranchSession, finishedBranchSession],
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
    { id: 'branch-short', parent: 'main-2', depth: 1, status: 'active' },
    { id: 'branch-inbox', parent: 'main-2', depth: 1, status: 'active' },
    { id: 'branch-2', parent: 'main-2', depth: 1, status: 'active' },
    { id: 'branch-2-1', parent: 'branch-2', depth: 2, status: 'active' },
    { id: 'branch-done', parent: 'main-2', depth: 1, status: 'resolved' },
  ],
  'cluster helper should preserve lineage metadata while grouping long-term children by GTD bucket order',
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
