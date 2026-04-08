#!/usr/bin/env node
import assert from 'assert/strict';
import { createSessionDetail, createSessionListItem } from '../backend/session-api-shapes.mjs';

const sourceSession = {
  id: 'session-1',
  name: '梳理 hooks',
  sourceContext: { parentSessionId: 'main-1' },
  queuedMessages: [{ id: 'q-1' }],
  scheduledTriggers: [{ id: 'legacy-trigger' }],
  taskCard: {
    goal: '拆 hooks',
    mainGoal: '梳理会话流程',
    lineRole: 'branch',
    branchFrom: '梳理会话流程',
    checkpoint: '先收敛 kernel hooks',
  },
};

const listItem = createSessionListItem(sourceSession);
assert.equal(listItem.sourceContext, undefined, 'session list item should still strip sourceContext');
assert.equal(listItem.queuedMessages, undefined, 'session list item should still hide queued messages');
assert.deepEqual(
  listItem.sessionState,
  {
    goal: '拆 hooks',
    mainGoal: '梳理会话流程',
    checkpoint: '先收敛 kernel hooks',
    needsUser: false,
    lineRole: 'branch',
    branchFrom: '梳理会话流程',
  },
  'session list item should expose a normalized sessionState projection',
);

const detail = createSessionDetail(sourceSession);
assert.equal(Array.isArray(detail.queuedMessages), true, 'session detail should preserve queued messages');
assert.deepEqual(
  detail.sessionState,
  listItem.sessionState,
  'session detail should expose the same normalized sessionState as the list shape',
);

console.log('test-session-api-shapes: ok');
