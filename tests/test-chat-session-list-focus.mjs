#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const sessionListUiSource = readFileSync(join(repoRoot, 'frontend-src', 'session-list', 'ui.js'), 'utf8');

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = source.indexOf('(', start + marker.length - 1);
  assert.notEqual(paramsStart, -1, `${functionName} should have parameters`);
  let paramsDepth = 0;
  let braceStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        braceStart = source.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(braceStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

const extractedSource = [
  'getSessionStateModelForList',
  'getSessionFocusReason',
  'getSessionFocusSectionData',
]
  .map((name) => extractFunctionSource(sessionListUiSource, name))
  .join('\n\n');

const sessions = [
  { id: 'skill-1', persistent: { kind: 'skill' }, workflowPriority: 'high' },
  { id: 'updated-1', workflowState: '', unread: true },
  { id: 'waiting-1', workflowState: 'waiting_user' },
  { id: 'priority-1', workflowState: '', workflowPriority: 'high' },
  { id: 'running-1', workflowState: '', activity: { run: { state: 'running' } } },
];

const context = {
  console,
  payloadSafeTranslate(key, fallback) {
    return fallback || key;
  },
  getSidebarPersistentKind(session) {
    const kind = String(session?.persistent?.kind || '').trim().toLowerCase();
    return kind === 'skill' ? 'skill' : '';
  },
  window: {
    MelodySyncSessionStateModel: {
      normalizeSessionWorkflowState(value) {
        return value === 'waiting_user' ? 'waiting_user' : '';
      },
      normalizeSessionActivity(session) {
        return session?.activity || { run: { state: 'idle' } };
      },
      hasSessionUnreadUpdate(session) {
        return session?.unread === true;
      },
      getSessionWorkflowPriorityInfo(session) {
        return session?.workflowPriority === 'high'
          ? { key: 'high', rank: 3 }
          : { key: 'medium', rank: 2 };
      },
      compareSessionListSessions(left, right) {
        return String(left?.id || '').localeCompare(String(right?.id || ''));
      },
    },
  },
};
context.globalThis = context;

vm.runInNewContext(
  `${extractedSource}
globalThis.getSessionFocusReason = getSessionFocusReason;
globalThis.getSessionFocusSectionData = getSessionFocusSectionData;`,
  context,
  { filename: 'frontend-src/session-list/ui.js' },
);

assert.deepEqual(
  JSON.parse(JSON.stringify(context.getSessionFocusSectionData(sessions))),
  {
    sessions: [
      { id: 'waiting-1', workflowState: 'waiting_user' },
      { id: 'running-1', workflowState: '', activity: { run: { state: 'running' } } },
      { id: 'updated-1', workflowState: '', unread: true },
    ],
    hintLabel: '等待你 1 · 进行中 1 · 有更新 1',
  },
  'focus section should prioritize waiting, running, and updated tasks while excluding persistent shortcuts',
);

assert.deepEqual(
  JSON.parse(JSON.stringify(context.getSessionFocusReason({ workflowPriority: 'high' }))),
  { key: 'priority', rank: 3, label: '优先处理' },
  'focus reason should fall back to high-priority tasks when no stronger attention signal exists',
);

console.log('test-chat-session-list-focus: ok');
