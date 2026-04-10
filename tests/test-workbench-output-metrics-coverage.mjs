#!/usr/bin/env node
import assert from 'assert/strict';

import { buildWorkbenchOutputMetrics } from '../backend/workbench/output-metrics-service.mjs';

const now = new Date('2026-04-09T12:00:00+08:00');

function makeSession({
  id,
  name,
  workflowState = '',
  updatedAt = '2026-04-09T10:00:00+08:00',
  created = '2026-04-09T09:00:00+08:00',
  lineRole = 'main',
  mainGoal = '',
  checkpoint = '',
  knownConclusions = [],
  archived = false,
} = {}) {
  const resolvedMainGoal = String(mainGoal || (lineRole === 'branch' ? '主线任务' : name || id || '未命名任务')).trim();
  const taskCard = {
    goal: String(name || id || '未命名任务').trim(),
    mainGoal: resolvedMainGoal,
  };
  if (lineRole === 'branch') {
    taskCard.lineRole = 'branch';
    taskCard.branchFrom = resolvedMainGoal;
  }
  if (checkpoint) taskCard.checkpoint = checkpoint;
  if (knownConclusions.length > 0) taskCard.knownConclusions = knownConclusions;
  return {
    id,
    name,
    workflowState,
    updatedAt,
    created,
    archived,
    taskCard,
  };
}

{
  const metrics = buildWorkbenchOutputMetrics({}, [
    makeSession({
      id: 'done-only',
      name: '纯收口任务',
      workflowState: 'done',
      updatedAt: '2026-04-09T11:00:00+08:00',
      created: '2026-04-07T09:00:00+08:00',
      checkpoint: '已经完成',
    }),
  ], { now });

  assert.equal(metrics.today.openedSessions, 0, 'pure closure days should not invent opened sessions');
  assert.equal(metrics.today.closedSessions, 1, 'pure closure days should still count closures');
  assert.equal(metrics.today.netOpenDelta, -1, 'pure closure days should shrink the task pool');
  assert.equal(metrics.today.endOpenSessions, 0, 'pure closure days should end with an empty task pool');
  assert.equal(metrics.today.convergenceRate, 1, 'pure closure days should be treated as fully converging');
  assert.equal(metrics.overview.loadLabel, '已清空', 'no open sessions should read as cleared');
}

{
  const metrics = buildWorkbenchOutputMetrics({}, [
    makeSession({ id: 'main-1', name: '主线一', checkpoint: '继续推进' }),
    makeSession({ id: 'main-2', name: '主线二', checkpoint: '继续推进' }),
    makeSession({ id: 'main-3', name: '主线三', checkpoint: '继续推进' }),
  ], { now });

  assert.equal(metrics.overview.activeMainSessions, 3, 'should count all active main sessions');
  assert.equal(metrics.overview.loadLabel, '主线偏多', 'more than two active main sessions should be flagged');
}

{
  const metrics = buildWorkbenchOutputMetrics({}, [
    makeSession({ id: 'branch-1', name: '支线一', lineRole: 'branch', mainGoal: '主线任务', checkpoint: '继续' }),
    makeSession({ id: 'branch-2', name: '支线二', lineRole: 'branch', mainGoal: '主线任务', checkpoint: '继续' }),
    makeSession({ id: 'branch-3', name: '支线三', lineRole: 'branch', mainGoal: '主线任务', checkpoint: '继续' }),
    makeSession({ id: 'branch-4', name: '支线四', lineRole: 'branch', mainGoal: '主线任务', checkpoint: '继续' }),
  ], { now });

  assert.equal(metrics.overview.activeBranchSessions, 4, 'should count all active branch sessions');
  assert.equal(metrics.overview.loadLabel, '支线偏多', 'more than three active branch sessions should be flagged');
}

{
  const metrics = buildWorkbenchOutputMetrics({}, [
    makeSession({
      id: 'parked-1',
      name: '暂停任务',
      workflowState: 'parked',
      checkpoint: '暂时停一下',
    }),
  ], { now });

  assert.equal(metrics.overview.parkedSessions, 1, 'parked sessions should stay visible in overview');
  assert.equal(metrics.overview.loadLabel, '多为停放', 'parked-only workloads should be called out separately');
}

{
  const metrics = buildWorkbenchOutputMetrics({}, [
    makeSession({ id: 'main-open', name: '主线开放', checkpoint: '' }),
    makeSession({ id: 'branch-open', name: '支线开放', lineRole: 'branch', mainGoal: '主线任务', checkpoint: '' }),
  ], { now });

  assert.equal(metrics.overview.openSessions, 2, 'open sessions should include active main and branch work');
  assert.equal(metrics.today.endOpenSessions, 2, 'low-structure open work should still surface the current open pool');
  assert.equal(metrics.overview.loadLabel, '待结构化', 'low-structure open work should be surfaced');
}

{
  const metrics = buildWorkbenchOutputMetrics({}, [
    makeSession({ id: 'active-1', name: '正常任务', checkpoint: '继续' }),
    makeSession({
      id: 'archived-waiting',
      name: '归档等待',
      workflowState: 'waiting_user',
      checkpoint: '已归档',
      archived: true,
    }),
  ], { now });

  assert.equal(metrics.overview.waitingSessions, 0, 'archived sessions should not leak into live overview counts');
  assert.equal(metrics.attention.length, 0, 'archived waiting sessions should not leak into attention list');
}

console.log('test-workbench-output-metrics-coverage: ok');
