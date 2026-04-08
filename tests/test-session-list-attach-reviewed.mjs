#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const sessionListSource = readFileSync(join(repoRoot, 'static', 'frontend', 'session-list', 'ui.js'), 'utf8');

function extractFunctionSource(code, functionName) {
  const marker = `function ${functionName}`;
  const start = code.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = code.indexOf('(', start);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < code.length; index += 1) {
    const char = code[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = code.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(bodyStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < code.length; index += 1) {
    const char = code[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(start, index + 1);
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

const resolveAttachedSessionRecordSource = extractFunctionSource(sessionListSource, 'resolveAttachedSessionRecord');
const attachSessionSource = extractFunctionSource(sessionListSource, 'attachSession');

const storedSession = {
  id: 'session-with-update',
  name: 'Unread task',
  lastEventAt: '2026-04-05T08:00:00.000Z',
};

const context = {
  console,
  Promise,
  sessions: [storedSession],
  hasAttachedSession: false,
  currentSessionId: '',
  markCalls: [],
  appliedCalls: [],
  dispatchCalls: [],
  focusCalls: [],
  clearCalls: 0,
  window: {
    MelodySyncWorkbench: {
      setFocusedSessionId(sessionId, options) {
        context.focusedSession = { sessionId, options };
      },
    },
  },
  clearMessages() {
    context.clearCalls += 1;
  },
  dispatchAction(payload) {
    context.dispatchCalls.push(payload);
  },
  applyAttachedSessionState(id, session) {
    context.appliedCalls.push({ id, session });
  },
  markSessionReviewed(session, options) {
    context.markCalls.push({ session, options });
    return session;
  },
  focusComposer(options) {
    context.focusCalls.push(options);
  },
  msgInput: {
    focus() {
      context.msgInputFocused = true;
    },
  },
};
context.globalThis = context;

vm.runInNewContext(`
  ${resolveAttachedSessionRecordSource}
  ${attachSessionSource}
  globalThis.attachSession = attachSession;
`, context, {
  filename: 'frontend/session-list/ui.js',
});

await context.attachSession('session-with-update', null);

assert.equal(context.appliedCalls.length, 1, 'attachSession should apply attached state once');
assert.equal(context.appliedCalls[0]?.id, 'session-with-update');
assert.equal(
  context.appliedCalls[0]?.session,
  storedSession,
  'attachSession should resolve the current session record before applying attached state',
);
assert.equal(context.markCalls.length, 1, 'attachSession should mark the session reviewed once');
assert.equal(
  context.markCalls[0]?.session,
  storedSession,
  'attachSession should still mark a session reviewed when callers only provide the session id',
);
assert.equal(context.markCalls[0]?.options?.sync, true);
assert.equal(context.markCalls[0]?.options?.render, true);
assert.equal(context.dispatchCalls.length, 1, 'reattaching by id should still dispatch the attach action');
assert.equal(context.dispatchCalls[0]?.action, 'attach');
assert.equal(context.dispatchCalls[0]?.sessionId, 'session-with-update');
assert.equal(context.focusCalls.length, 1, 'attachSession should keep focusing the composer after navigation');
assert.equal(context.focusCalls[0]?.preventScroll, true);

console.log('test-session-list-attach-reviewed: ok');
