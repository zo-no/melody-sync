#!/usr/bin/env node
import assert from 'assert/strict';

import { handleSystemWriteRoutes } from '../backend/controllers/system/write-routes.mjs';

const writes = [];
const dispatchSignals = [];
const branchCalls = [];

const handled = await handleSystemWriteRoutes({
  req: { method: 'POST' },
  res: {},
  pathname: '/api/pm-loop/opportunities/opp-1/dispatch',
  writeJson(_res, status, payload) {
    writes.push({ status, payload });
  },
  getAuthSession() {
    return { role: 'owner' };
  },
  readPmLoopState: async () => ({
    opportunities: [
      {
        id: 'opp-1',
        title: '功能面板，自动pm功能',
        problem: '减少重复澄清。',
        primarySessionId: 'main-1',
      },
    ],
    specs: [
      {
        opportunityId: 'opp-1',
        title: '自动 PM 分支派发',
        trigger: '功能面板，自动pm功能',
        desiredBehavior: '宿主应直接派发一条支线。',
      },
    ],
  }),
  getWorkbenchSession: async (sessionId) => (sessionId === 'main-1' ? { id: 'main-1', name: 'Main Session' } : null),
  createBranchFromSession: async (sessionId, payload) => {
    branchCalls.push({ sessionId, payload });
    return {
      session: { id: 'branch-1', name: `Branch · ${payload.goal}` },
      branchContext: { goal: payload.goal },
    };
  },
  recordBranchDispatchSignal: async (sessionId, payload) => {
    dispatchSignals.push({ sessionId, payload });
    return true;
  },
});

assert.equal(handled, true, 'pm-loop dispatch route should be handled');
assert.equal(branchCalls.length, 1, 'dispatch route should create a branch from the primary session');
assert.equal(branchCalls[0].sessionId, 'main-1', 'dispatch route should use the opportunity primary session');
assert.equal(branchCalls[0].payload.goal, '自动 PM 分支派发', 'dispatch route should derive branch title from the spec');
assert.match(branchCalls[0].payload.branchReason, /PM loop 自动派发/, 'dispatch route should stamp a host-owned branch reason');
assert.equal(dispatchSignals.length, 2, 'dispatch route should record attempt and success telemetry');
assert.equal(dispatchSignals[0].payload.outcome, 'attempt', 'dispatch route should record the attempt before creating the branch');
assert.equal(dispatchSignals[1].payload.outcome, 'success', 'dispatch route should record success after branch creation');
assert.equal(writes.length, 1, 'dispatch route should send one response');
assert.equal(writes[0].status, 201, 'dispatch route should respond with created status');
assert.equal(writes[0].payload.session.id, 'branch-1', 'dispatch route should return the created branch session');
assert.equal(writes[0].payload.dispatch.opportunityId, 'opp-1', 'dispatch route should echo the dispatched opportunity');

console.log('test-pm-loop-dispatch-route: ok');
