#!/usr/bin/env node
import assert from 'assert/strict';
import { emit, registerHook } from '../backend/hooks/runtime/registry.mjs';

const traceEvents = [];
const traceEventPattern = 'test.hook-trace-visible';

registerHook(traceEventPattern, async () => {}, {
  id: 'test.visible-hook',
  label: '可见 Hook',
  eventPattern: traceEventPattern,
});

registerHook(traceEventPattern, async () => {
  throw new Error('boom');
}, {
  id: 'test.failed-hook',
  label: '失败 Hook',
  eventPattern: traceEventPattern,
});

const result = await emit(traceEventPattern, {
  sessionId: 'sess-hook-trace',
  appendEvent: async (sessionId, event) => {
    traceEvents.push({ sessionId, event });
  },
  statusEvent: (content, extra = {}) => ({
    type: 'status',
    content,
    ...extra,
  }),
});

assert.equal(result.hookCount, 2, 'emit should still execute all matching hooks');
assert.equal(result.traceAppendedCount, 2, 'emit should append one visible trace event per executed hook');
assert.equal(traceEvents.length, 2, 'hook execution should be surfaced as individual session events');
assert.equal(traceEvents[0].sessionId, 'sess-hook-trace');
assert.match(traceEvents[0].event.content, /hook: test\.hook-trace-visible · 可见 Hook/);
assert.equal(traceEvents[0].event.statusKind, 'hook_trace');
assert.equal(traceEvents[0].event.hookOutcome, 'completed');
assert.match(traceEvents[1].event.content, /hook: test\.hook-trace-visible · 失败 Hook \[failed\] boom/);
assert.equal(traceEvents[1].event.hookOutcome, 'failed');

console.log('test-hook-trace-events: ok');
