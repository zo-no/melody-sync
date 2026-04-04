#!/usr/bin/env node
import assert from 'assert/strict';

import { createSessionNamingHook } from '../backend/hooks/session-naming-hook.mjs';

const calls = [];
const hook = createSessionNamingHook({
  isSessionAutoRenamePending: () => false,
  triggerAutomaticSessionLabeling: async (sessionId, session) => {
    calls.push({ sessionId, session });
    return {
      ok: true,
      skipped: 'session_labels_not_needed',
      rename: { attempted: false, renamed: false },
    };
  },
});

await hook({
  sessionId: 'session-1',
  session: { id: 'session-1', name: '已命名任务', autoRenamePending: false },
  manifest: { internalOperation: null },
});

assert.equal(calls.length, 1, 'session-naming hook should always invoke the naming pipeline for normal completed runs');
assert.equal(calls[0]?.sessionId, 'session-1');

await hook({
  sessionId: 'session-2',
  session: { id: 'session-2', name: '内部任务' },
  manifest: { internalOperation: 'compact-session' },
});

assert.equal(calls.length, 1, 'session-naming hook should still skip internal operations');

console.log('test-session-naming-hook: ok');
