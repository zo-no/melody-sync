#!/usr/bin/env node
import assert from 'assert/strict';
import { buildTaskClusters } from '../backend/workbench/continuity-store.mjs';

const mainSession = {
  id: 'main-1',
  name: '主线会话',
  updatedAt: '2026-04-08T10:00:00.000Z',
  sessionState: {
    goal: '梳理会话流程',
    mainGoal: '梳理会话流程',
    checkpoint: '主线推进中',
    lineRole: 'main',
  },
};

const branchSession = {
  id: 'branch-1',
  name: '支线会话',
  updatedAt: '2026-04-08T10:10:00.000Z',
  sourceContext: { parentSessionId: 'main-1' },
  sessionState: {
    goal: '拆 hooks',
    mainGoal: '梳理会话流程',
    checkpoint: '拆成 kernel hooks',
    lineRole: 'branch',
    branchFrom: '梳理会话流程',
  },
  taskCard: {
    goal: '旧 taskCard 文本',
    mainGoal: '旧主线',
    lineRole: 'main',
  },
};

const clusters = buildTaskClusters({ branchContexts: [] }, [mainSession, branchSession]);

assert.equal(clusters.length, 1, 'session state should still synthesize a single cluster');
assert.equal(clusters[0].mainSessionId, 'main-1');
assert.equal(clusters[0].mainGoal, '梳理会话流程');
assert.deepEqual(
  clusters[0].branchSessionIds,
  ['branch-1'],
  'branch sessions should be grouped by sessionState before falling back to taskCard',
);

console.log('test-workbench-continuity-store-session-state: ok');
