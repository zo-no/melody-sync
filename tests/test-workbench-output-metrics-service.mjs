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
  {
    id: 'done-main-2',
    name: '完成主线',
    workflowState: 'done',
    updatedAt: '2026-04-09T11:30:00+08:00',
    created: '2026-04-07T15:00:00+08:00',
    messageCount: 5,
    taskCard: {
      goal: '完成主线',
      mainGoal: '完成主线',
      checkpoint: '主线已经收口',
      knownConclusions: ['主线结果已确认'],
    },
  },
  {
    id: 'long-term-1',
    name: '每周复盘',
    workflowState: '',
    updatedAt: '2026-04-09T11:50:00+08:00',
    created: '2026-04-09T11:00:00+08:00',
    persistent: {
      kind: 'recurring_task',
    },
    taskCard: {
      goal: '每周复盘',
      mainGoal: '每周复盘',
      checkpoint: '整理本周项目变化',
    },
  },
  {
    id: 'long-term-branch-1',
    name: '长期维护支线',
    rootSessionId: 'long-term-1',
    sourceContext: {
      parentSessionId: 'long-term-1',
    },
    workflowState: '',
    updatedAt: '2026-04-09T11:55:00+08:00',
    created: '2026-04-09T11:20:00+08:00',
    messageCount: 3,
    taskCard: {
      goal: '长期维护支线',
      mainGoal: '每周复盘',
      lineRole: 'branch',
      branchFrom: '每周复盘',
      checkpoint: '继续补长期维护项',
    },
  },
];

const metrics = buildWorkbenchOutputMetrics(state, sessions, { now });

assert.equal(metrics.overview.openSessions, 2, 'should count currently open sessions');
assert.equal(metrics.overview.activeMainSessions, 1, 'should count active main sessions');
assert.equal(metrics.overview.activeBranchSessions, 0, 'resolved branch should not count as active branch');
assert.equal(metrics.overview.waitingSessions, 1, 'should count waiting sessions');
assert.equal(metrics.overview.loadLabel, '待处理', 'load label should highlight waiting work');
assert.equal(metrics.today.openedSessions, 2, 'today should count newly opened sessions');
assert.equal(metrics.today.completedSessions, 1, 'today should count standalone completed sessions');
assert.equal(metrics.today.resolvedBranches, 1, 'today should count resolved branches');
assert.equal(metrics.today.closedSessions, 2, 'today closed sessions should combine completion and convergence without overlap');
assert.equal(metrics.today.netOpenDelta, 0, 'today task pool should stay flat when open and close counts match');
assert.equal(metrics.today.endOpenSessions, 2, 'today should expose the day-end open task pool');
assert.equal(metrics.week.openedSessions, 4, 'week should count newly opened sessions');
assert.equal(metrics.week.closedSessions, 2, 'week should count effective closures');
assert.equal(metrics.week.netOpenDelta, 2, 'week task pool delta should reflect newly opened minus closed work');
assert.equal(metrics.week.endOpenSessions, 2, 'week should expose the current visible open task pool');
assert.equal(metrics.week.convergenceRate, 0.5, 'week convergence rate should compare effective closures with new work');
assert.ok(metrics.recentWins.some((entry) => entry.type === 'branch_resolved'), 'recent wins should include resolved branches');
assert.ok(metrics.recentWins.some((entry) => entry.type === 'session_done' && entry.title === '完成主线'), 'recent wins should include standalone completed sessions');
assert.equal(metrics.recentWins.filter((entry) => entry.title === '收束支线').length, 1, 'resolved branch should not also appear as a separate completed-session win');
assert.equal(metrics.recentWins.some((entry) => entry.title === '每周复盘'), false, 'persistent long-term projects should stay out of the task win stream');
assert.ok(metrics.attention.some((entry) => entry.type === 'waiting_user'), 'attention should surface waiting sessions');
assert.equal(metrics.trend.length, 7, 'trend should cover the last 7 days');
assert.equal(metrics.trend.at(-1)?.endOpenSessions, 2, 'daily trend should expose the end-of-day open pool');
assert.equal(Object.prototype.hasOwnProperty.call(metrics.overview, 'totalSessions'), false, 'overview should not expose unused total session counts');
assert.equal(Object.prototype.hasOwnProperty.call(metrics.overview, 'doneSessions'), false, 'overview should not expose redundant historical done totals');
assert.equal(Object.prototype.hasOwnProperty.call(metrics.overview, 'focusScore'), false, 'overview should not expose abstract focus scores');
assert.equal(Object.prototype.hasOwnProperty.call(metrics.today, 'score'), false, 'window payload should not expose abstract score fields');
assert.equal(Object.prototype.hasOwnProperty.call(metrics.today, 'createdSessions'), false, 'window payload should not expose unused created-session counts');

const longTermMetrics = buildWorkbenchOutputMetrics(state, sessions, {
  now,
  scope: 'long-term',
});

assert.equal(longTermMetrics.scope, 'long-term', 'long-term metrics should expose the resolved scope');
assert.equal(longTermMetrics.overview.openSessions, 1, 'long-term scope should surface only long-term-line open work');
assert.equal(longTermMetrics.overview.activeMainSessions, 0, 'long-term scope should not count the recurring project root as an active main task');
assert.equal(longTermMetrics.overview.activeBranchSessions, 1, 'long-term scope should count branch maintenance work under the long-term root');
assert.equal(longTermMetrics.week.openedSessions, 1, 'long-term scope should keep its own opened-session counts');
assert.equal(longTermMetrics.week.endOpenSessions, 1, 'long-term scope should expose its own open pool');
assert.equal(longTermMetrics.recentWins.some((entry) => entry.title === '每周复盘'), false, 'long-term project roots should stay out of long-term task wins too');

console.log('test-workbench-output-metrics-service: ok');
