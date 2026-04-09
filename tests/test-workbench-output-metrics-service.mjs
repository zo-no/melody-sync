#!/usr/bin/env node
import assert from 'assert/strict';
import { buildWorkbenchOutputMetrics } from '../backend/workbench/output-metrics-service.mjs';

const now = new Date('2026-04-09T12:00:00+08:00');

const state = {
  branchContexts: [
    {
      id: 'ctx-main',
      sessionId: 'main-1',
      lineRole: 'main',
      status: 'active',
      updatedAt: '2026-04-09T09:10:00+08:00',
      goal: '推进主线任务',
      mainGoal: '推进主线任务',
    },
    {
      id: 'ctx-branch',
      sessionId: 'branch-1',
      parentSessionId: 'main-1',
      lineRole: 'branch',
      status: 'resolved',
      updatedAt: '2026-04-09T10:40:00+08:00',
      goal: '收束支线',
      mainGoal: '推进主线任务',
    },
    {
      id: 'ctx-waiting',
      sessionId: 'waiting-1',
      lineRole: 'main',
      status: 'active',
      updatedAt: '2026-04-09T08:20:00+08:00',
      goal: '等待输入',
      mainGoal: '等待输入',
    },
  ],
};

const sessions = [
  {
    id: 'main-1',
    name: '推进主线任务',
    workflowState: '',
    updatedAt: '2026-04-09T09:10:00+08:00',
    created: '2026-04-08T12:00:00+08:00',
    messageCount: 8,
    taskCard: {
      goal: '推进主线任务',
      mainGoal: '推进主线任务',
      checkpoint: '把主线再推进一步',
      knownConclusions: ['已确定实现方向'],
    },
  },
  {
    id: 'branch-1',
    name: '收束支线',
    workflowState: 'done',
    updatedAt: '2026-04-09T10:40:00+08:00',
    created: '2026-04-09T07:00:00+08:00',
    messageCount: 4,
    taskCard: {
      goal: '收束支线',
      mainGoal: '推进主线任务',
      lineRole: 'branch',
      branchFrom: '推进主线任务',
      checkpoint: '把支线结果合回主线',
      knownConclusions: ['支线结论可复用'],
    },
  },
  {
    id: 'waiting-1',
    name: '等待输入',
    workflowState: 'waiting_user',
    updatedAt: '2026-04-09T08:20:00+08:00',
    created: '2026-04-09T08:00:00+08:00',
    messageCount: 2,
    taskCard: {
      goal: '等待输入',
      mainGoal: '等待输入',
      checkpoint: '等我补一个决策',
    },
  },
];

const metrics = buildWorkbenchOutputMetrics(state, sessions, { now });

assert.equal(metrics.overview.activeMainSessions, 1, 'should count active main sessions');
assert.equal(metrics.overview.activeBranchSessions, 0, 'resolved branch should not count as active branch');
assert.equal(metrics.overview.waitingSessions, 1, 'should count waiting sessions');
assert.equal(metrics.today.completedSessions, 1, 'today should count completed sessions');
assert.equal(metrics.today.resolvedBranches, 1, 'today should count resolved branches');
assert.equal(metrics.week.structuredSessions, 3, 'structured touched sessions should include checkpoint-bearing sessions');
assert.ok(metrics.recentWins.some((entry) => entry.type === 'branch_resolved'), 'recent wins should include resolved branches');
assert.equal(metrics.recentWins.filter((entry) => entry.title === '收束支线').length, 1, 'resolved branch should not also appear as a separate completed-session win');
assert.ok(metrics.attention.some((entry) => entry.type === 'waiting_user'), 'attention should surface waiting sessions');
assert.equal(metrics.trend.length, 7, 'trend should cover the last 7 days');
assert.equal(Object.prototype.hasOwnProperty.call(metrics.overview, 'totalSessions'), false, 'overview should not expose unused total session counts');
assert.equal(Object.prototype.hasOwnProperty.call(metrics.overview, 'doneSessions'), false, 'overview should not expose redundant historical done totals');
assert.equal(Object.prototype.hasOwnProperty.call(metrics.today, 'createdSessions'), false, 'window payload should not expose unused created-session counts');

console.log('test-workbench-output-metrics-service: ok');
