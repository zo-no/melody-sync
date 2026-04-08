#!/usr/bin/env node
import assert from 'assert/strict';
import { resolveSessionStateFromSession } from '../backend/session-state.mjs';

const fallbackSession = {
  name: '整理会话流程',
  workflowState: 'waiting_user',
  taskCard: {
    goal: '梳理 hooks 和 state',
    mainGoal: '梳理会话流程',
    lineRole: 'branch',
    branchFrom: '梳理会话流程',
    checkpoint: '先收敛 event bus',
    needsFromUser: ['确认是否拆 rules 层'],
  },
};

assert.deepEqual(
  resolveSessionStateFromSession(fallbackSession, { parentSessionId: 'parent-1' }),
  {
    goal: '梳理 hooks 和 state',
    mainGoal: '梳理会话流程',
    checkpoint: '先收敛 event bus',
    needsUser: true,
    lineRole: 'branch',
    branchFrom: '梳理会话流程',
  },
  'session state should fall back to taskCard and workflow hints when explicit sessionState is absent',
);

const explicitStateSession = {
  name: '旧名称',
  sessionState: {
    goal: '重构 session_state',
    mainGoal: '梳理会话流程',
    checkpoint: '先把 taskCard 降级为适配层',
    needsUser: false,
    lineRole: 'main',
    branchFrom: 'should-be-cleared',
  },
  taskCard: {
    goal: '不应覆盖显式 state',
    checkpoint: '不应覆盖显式 state',
    lineRole: 'branch',
    branchFrom: '不应保留',
  },
};

assert.deepEqual(
  resolveSessionStateFromSession(explicitStateSession),
  {
    goal: '重构 session_state',
    mainGoal: '梳理会话流程',
    checkpoint: '先把 taskCard 降级为适配层',
    needsUser: false,
    lineRole: 'main',
    branchFrom: '',
  },
  'explicit sessionState should win over legacy taskCard fallbacks',
);

console.log('test-session-state: ok');
