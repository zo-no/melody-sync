#!/usr/bin/env node
import assert from 'assert/strict';

import { buildPmLoopOverview } from '../backend/controllers/system/read-routes.mjs';

const overview = await buildPmLoopOverview({
  loadState: async () => ({
    events: [{ id: 'evt-1' }],
    signals: [{ id: 'sig-1', signalType: 'tool_chain_break', status: 'open', impactedUsers: 3 }],
    opportunities: [
      {
        id: 'opp-1',
        title: '功能面板，自动pm功能',
        problem: '用户每次都要重新解释同一类派发诉求。',
        priorityScore: 0.92,
        impactedUsers: 5,
        primarySessionId: 'main-1',
        status: 'accepted',
      },
    ],
    specs: [
      {
        id: 'spec-1',
        opportunityId: 'opp-1',
        title: '自动 PM 分支派发',
        trigger: '功能面板，自动pm功能',
        desiredBehavior: '宿主应直接提供一等 branch dispatch flow。',
        references: ['Bounded Autonomy', 'Next Best Action'],
      },
    ],
    experiments: [],
    decisions: [],
  }),
  loadReport: async () => 'latest report',
  loadWorkerLog: async () => 'worker log',
  loadWorkerPid: async () => '123',
  loadStateUpdatedAt: async () => '2026-04-09T10:00:00.000Z',
  loadReportUpdatedAt: async () => '2026-04-09T10:01:00.000Z',
  loadWorkerLogUpdatedAt: async () => '2026-04-09T10:02:00.000Z',
  loadWorkbenchOutputMetrics: async () => ({
    generatedAt: '2026-04-09T10:03:00.000Z',
    workflowSignals: {
      repeatedClarificationCount: 4,
      repeatedClarificationInWindow: 2,
      branchDispatch: {
        attempts: 3,
        successes: 2,
        failures: 1,
        dayAttempts: 2,
        daySuccesses: 1,
        dayFailures: 1,
        successRate: 0.6667,
        daySuccessRate: 0.5,
      },
    },
  }),
  loadWorkbenchSessions: async () => ([
    {
      id: 'main-1',
      name: 'delegate - Opportunity',
      workflowSignals: {
        repeatedClarificationCount: 2,
        lastRepeatedClarificationAt: '2026-04-09T09:20:00.000Z',
        branchDispatch: {
          attempts: 2,
          successes: 1,
          failures: 1,
          lastOutcome: 'failure',
          lastFailureReason: 'Parent node not found',
        },
      },
    },
  ]),
});

assert.equal(overview.workbench.workflowSignals.repeatedClarificationInWindow, 2, 'overview should surface repeated clarification telemetry');
assert.equal(overview.workbench.workflowSignals.branchDispatch.daySuccessRate, 0.5, 'overview should surface aggregate branch dispatch success rate');
assert.equal(overview.opportunities.length, 1, 'overview should keep opportunity list');
assert.equal(overview.opportunities[0].dispatch.available, true, 'accepted opportunities with a primary session should expose dispatch');
assert.equal(overview.opportunities[0].dispatch.branchTitle, '自动 PM 分支派发', 'dispatch should use spec title as the first-class branch title');
assert.match(overview.opportunities[0].dispatch.branchReason, /PM loop 自动派发/, 'dispatch should explain host-owned branch dispatch');
assert.equal(overview.opportunities[0].telemetry.repeatedClarificationCount, 2, 'overview should project per-session clarification telemetry onto the opportunity');
assert.equal(overview.opportunities[0].telemetry.branchDispatch.lastOutcome, 'failure', 'overview should project per-session branch dispatch telemetry');

console.log('test-pm-loop-overview: ok');
