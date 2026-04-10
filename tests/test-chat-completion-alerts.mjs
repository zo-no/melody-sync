#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const sessionHttpPath = existsSync(join(repoRoot, 'frontend-src', 'session', 'http.js'))
  ? join(repoRoot, 'frontend-src', 'session', 'http.js')
  : join(repoRoot, 'static', 'frontend', 'session', 'http.js');
const sessionHttpSource = readFileSync(sessionHttpPath, 'utf8');

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

const normalizeCompletionWorkflowStateSource = extractFunctionSource(sessionHttpSource, 'normalizeCompletionWorkflowState');
const getCompletionStampSource = extractFunctionSource(sessionHttpSource, 'getCompletionStamp');
const shouldNotifyCompletionSource = extractFunctionSource(sessionHttpSource, 'shouldNotifyCompletion');
const buildCompletionNoticeKeySource = extractFunctionSource(sessionHttpSource, 'buildCompletionNoticeKey');
const handleCompletionAlertsSource = extractFunctionSource(sessionHttpSource, 'handleCompletionAlerts');
const refreshCompletionAlertsOnForegroundSource = extractFunctionSource(sessionHttpSource, 'refreshCompletionAlertsOnForeground');

const played = [];
const notified = [];
const attention = [];
const context = {
  console,
  Date,
  Map,
  notifiedCompletionStamps: new Map(),
  completionForegroundRefreshPromise: null,
  lastCompletionForegroundRefreshAt: 0,
  foregroundRefreshCalls: 0,
  playCompletionSound() {
    played.push('ding');
  },
  showCompletionAttention(session) {
    attention.push(session.id);
  },
  notifyCompletion(session) {
    notified.push(session.id);
  },
  fetchSessionsList() {
    context.foregroundRefreshCalls += 1;
    return Promise.resolve([]);
  },
};
context.globalThis = context;

vm.runInNewContext(`
  ${normalizeCompletionWorkflowStateSource}
  ${getCompletionStampSource}
  ${shouldNotifyCompletionSource}
  ${buildCompletionNoticeKeySource}
  ${refreshCompletionAlertsOnForegroundSource}
  ${handleCompletionAlertsSource}
  globalThis.shouldNotifyCompletion = shouldNotifyCompletion;
  globalThis.handleCompletionAlerts = handleCompletionAlerts;
  globalThis.refreshCompletionAlertsOnForeground = refreshCompletionAlertsOnForeground;
`, context, {
  filename: 'frontend-src/session/http.js',
});

assert.equal(
  context.shouldNotifyCompletion(
    { id: 'task-1', workflowState: 'done' },
    { id: 'task-1', workflowState: 'running' },
  ),
  true,
  'transitioning from a non-done state to done should trigger completion alerts',
);

context.handleCompletionAlerts(
  { id: 'task-1', workflowState: 'done', updatedAt: '2026-04-05T12:00:00.000Z' },
  { id: 'task-1', workflowState: 'running', updatedAt: '2026-04-05T11:59:00.000Z' },
);

assert.deepEqual(played, ['ding'], 'first done transition should play a single completion sound');
assert.deepEqual(attention, ['task-1'], 'first done transition should also surface the stronger in-browser attention state');
assert.deepEqual(notified, ['task-1'], 'first done transition should emit a browser notification');

context.handleCompletionAlerts(
  { id: 'task-1', workflowState: 'done', updatedAt: '2026-04-05T12:00:00.000Z' },
  { id: 'task-1', workflowState: 'running', updatedAt: '2026-04-05T11:59:00.000Z' },
);

assert.deepEqual(played, ['ding'], 'repeat polling of the same completion stamp should not replay the sound');
assert.deepEqual(attention, ['task-1'], 'repeat polling of the same completion stamp should not duplicate the attention state');
assert.deepEqual(notified, ['task-1'], 'repeat polling of the same completion stamp should not duplicate notifications');

context.completionSoundEnabled = false;
context.handleCompletionAlerts(
  { id: 'task-3', workflowState: 'done', updatedAt: '2026-04-05T13:00:00.000Z' },
  { id: 'task-3', workflowState: 'running', updatedAt: '2026-04-05T12:59:00.000Z' },
);

assert.deepEqual(played, ['ding'], 'completion sound toggle should silence audio when disabled');
assert.deepEqual(attention, ['task-1', 'task-3'], 'the stronger in-browser attention state should still appear when sound is disabled');
assert.deepEqual(notified, ['task-1', 'task-3'], 'browser notifications should still fire when sound is disabled');

context.handleCompletionAlerts(
  { id: 'task-2', workflowState: 'running', updatedAt: '2026-04-05T12:00:00.000Z' },
  { id: 'task-2', workflowState: 'running', updatedAt: '2026-04-05T11:59:00.000Z' },
);

assert.deepEqual(played, ['ding'], 'non-done transitions should stay silent');
assert.deepEqual(attention, ['task-1', 'task-3'], 'non-done transitions should not trigger completion attention');
assert.deepEqual(notified, ['task-1', 'task-3'], 'non-done transitions should not notify');

await context.refreshCompletionAlertsOnForeground();
assert.equal(
  context.foregroundRefreshCalls,
  1,
  'foreground refresh should pull the session list once',
);

await context.refreshCompletionAlertsOnForeground();
assert.equal(
  context.foregroundRefreshCalls,
  1,
  'foreground refresh should throttle duplicate pulls inside the cooldown window',
);

console.log('test-chat-completion-alerts: ok');
