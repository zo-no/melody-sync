#!/usr/bin/env node
import assert from 'assert/strict';

import { buildOutputPanelPayload } from '../backend/services/output-panel/read-service.mjs';

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
  ],
};

const sessions = [
  {
    id: 'main-1',
    name: '推进主线任务',
    workflowState: '',
    updatedAt: '2026-04-09T09:10:00+08:00',
    created: '2026-04-08T12:00:00+08:00',
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
    taskCard: {
      goal: '收束支线',
      mainGoal: '推进主线任务',
      lineRole: 'branch',
      branchFrom: '推进主线任务',
      checkpoint: '把支线结果合回主线',
      knownConclusions: ['支线结论可复用'],
    },
  },
];

const payload = buildOutputPanelPayload(state, sessions, {
  now,
  sessionId: 'branch-1',
});

assert.equal(payload.currentSession?.id, 'branch-1', 'should attach current session snapshot when sessionId is provided');
assert.equal(payload.currentSession?.title, '收束支线', 'current session snapshot should expose a readable title');
assert.equal(payload.currentSession?.lineRole, 'branch', 'current session snapshot should preserve the line role');
assert.equal(payload.currentSession?.workflowState, 'done', 'current session snapshot should expose workflow state');
assert.equal(payload.currentSession?.overview, '推进主线任务', 'branch snapshots should expose the parent line overview');
assert.equal(payload.currentSession?.checkpoint, '把支线结果合回主线', 'current session snapshot should expose checkpoint text');
assert.equal(payload.currentSession?.knownConclusionsCount, 1, 'current session snapshot should summarize known conclusions');
assert.equal(payload.week.closedSessions, 1, 'output payload should still include overall metrics');
assert.equal(payload.week.endOpenSessions, 1, 'output payload should expose the visible open task pool at window end');

const payloadWithoutSession = buildOutputPanelPayload(state, sessions, { now });
assert.equal(payloadWithoutSession.currentSession, null, 'session snapshot should be optional');

const scopedPayload = buildOutputPanelPayload({
  branchContexts: [],
}, [
  {
    id: 'long-term-root',
    name: 'MelodySync',
    workflowState: '',
    updatedAt: '2026-04-09T11:50:00+08:00',
    created: '2026-04-09T09:00:00+08:00',
    persistent: {
      kind: 'recurring_task',
    },
    taskCard: {
      goal: 'MelodySync',
      mainGoal: 'MelodySync',
      checkpoint: '维护长期项目主线',
    },
  },
  {
    id: 'long-term-branch',
    name: '长期维护支线',
    rootSessionId: 'long-term-root',
    sourceContext: {
      parentSessionId: 'long-term-root',
    },
    workflowState: '',
    updatedAt: '2026-04-09T11:55:00+08:00',
    created: '2026-04-09T11:20:00+08:00',
    taskCard: {
      goal: '长期维护支线',
      mainGoal: 'MelodySync',
      lineRole: 'branch',
      branchFrom: 'MelodySync',
      checkpoint: '继续维护长期任务线',
    },
  },
  {
    id: 'regular-session',
    name: '普通任务',
    workflowState: '',
    updatedAt: '2026-04-09T10:10:00+08:00',
    created: '2026-04-09T09:40:00+08:00',
    taskCard: {
      goal: '普通任务',
      mainGoal: '普通任务',
      checkpoint: '继续推进普通任务',
    },
  },
], {
  now,
  sessionId: 'long-term-branch',
});

assert.equal(scopedPayload.scope, 'long-term', 'current long-term branch context should switch the output panel into long-term scope');
assert.equal(scopedPayload.overview.openSessions, 1, 'long-term scope should only count long-term-line tasks');
assert.equal(scopedPayload.currentSession?.id, 'long-term-branch', 'scope inference should keep the current session snapshot intact');

const defaultScopedPayload = buildOutputPanelPayload({
  branchContexts: [],
}, [
  {
    id: 'long-term-root',
    name: 'MelodySync',
    workflowState: '',
    updatedAt: '2026-04-09T11:50:00+08:00',
    created: '2026-04-09T09:00:00+08:00',
    persistent: {
      kind: 'recurring_task',
    },
    taskCard: {
      goal: 'MelodySync',
      mainGoal: 'MelodySync',
      checkpoint: '维护长期项目主线',
    },
  },
  {
    id: 'long-term-branch',
    name: '长期维护支线',
    rootSessionId: 'long-term-root',
    sourceContext: {
      parentSessionId: 'long-term-root',
    },
    workflowState: '',
    updatedAt: '2026-04-09T11:55:00+08:00',
    created: '2026-04-09T11:20:00+08:00',
    taskCard: {
      goal: '长期维护支线',
      mainGoal: 'MelodySync',
      lineRole: 'branch',
      branchFrom: 'MelodySync',
      checkpoint: '继续维护长期任务线',
    },
  },
  {
    id: 'regular-session',
    name: '普通任务',
    workflowState: '',
    updatedAt: '2026-04-09T10:10:00+08:00',
    created: '2026-04-09T09:40:00+08:00',
    taskCard: {
      goal: '普通任务',
      mainGoal: '普通任务',
      checkpoint: '继续推进普通任务',
    },
  },
], {
  now,
});

assert.equal(defaultScopedPayload.scope, 'sessions', 'panel without a long-term context should stay on the regular task scope');
assert.equal(defaultScopedPayload.overview.openSessions, 1, 'default scope should exclude long-term-line branches from regular metrics');

console.log('test-output-panel-read-service: ok');
