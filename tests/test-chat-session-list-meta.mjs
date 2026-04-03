#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const sessionSurfaceUiSource = readFileSync(join(repoRoot, 'static', 'chat', 'session/surface-ui.js'), 'utf8');

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = source.indexOf('(', start);
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

const getShortFolderSource = extractFunctionSource(sessionSurfaceUiSource, 'getShortFolder');
const getFolderLabelSource = extractFunctionSource(sessionSurfaceUiSource, 'getFolderLabel');
const clipTaskLabelSource = extractFunctionSource(sessionSurfaceUiSource, 'clipTaskLabel');
const toSingleGoalLabelSource = extractFunctionSource(sessionSurfaceUiSource, 'toSingleGoalLabel');
const getPreferredSessionDisplayNameSource = extractFunctionSource(sessionSurfaceUiSource, 'getPreferredSessionDisplayName');
const getSessionDisplayNameSource = extractFunctionSource(sessionSurfaceUiSource, 'getSessionDisplayName');
const renderSessionMessageCountSource = extractFunctionSource(sessionSurfaceUiSource, 'renderSessionMessageCount');
const buildSessionMetaPartsSource = extractFunctionSource(sessionSurfaceUiSource, 'buildSessionMetaParts');

const state = { scopeCalls: 0, statusCalls: 0 };
const context = {
  console,
  esc(value) {
    return String(value || '');
  },
  t(key) {
    if (key === 'session.defaultName') return 'Untitled';
    if (key === 'session.messagesTitle') return 'Messages in this session';
    if (key === 'session.messages') {
      const vars = arguments[1] || {};
      return `${vars.count || 0} msg${vars.suffix || ''}`;
    }
    return key;
  },
  renderSessionScopeContext() {
    state.scopeCalls += 1;
    return ['<span>scope</span>'];
  },
  getSessionReviewStatusInfo() {
    return null;
  },
  getSessionStatusSummary() {
    return { primary: { key: 'running', label: 'running' } };
  },
  renderSessionStatusHtml(statusInfo) {
    if (!statusInfo?.label) return '';
    state.statusCalls += 1;
    return `<span>${statusInfo.label}</span>`;
  },
};
context.globalThis = context;
vm.runInNewContext(
  `${getShortFolderSource}\n${getFolderLabelSource}\n${clipTaskLabelSource}\n${toSingleGoalLabelSource}\n${getPreferredSessionDisplayNameSource}\n${getSessionDisplayNameSource}\n${renderSessionMessageCountSource}\n${buildSessionMetaPartsSource}\nglobalThis.getSessionDisplayName = getSessionDisplayName;\nglobalThis.renderSessionMessageCount = renderSessionMessageCount;\nglobalThis.buildSessionMetaParts = buildSessionMetaParts;`,
  context,
  { filename: 'static/chat/session/surface-ui.js' },
);

assert.equal(
  context.getSessionDisplayName({
    name: '这是一个特别长的任务标题，需要先把目标压缩清楚并且不要把太多背景描述直接塞进侧栏里。后面这些细节不该直接出现在侧栏里',
    taskCard: {},
  }),
  '这是一个特别长的任务标题，需要先把目标压缩清楚并且不要把太多背景描述直接塞…',
  'session list should compress long task names to one explicit goal',
);

assert.equal(
  context.renderSessionMessageCount({ messageCount: 5, activeMessageCount: 2 }),
  '<span class="session-item-count" title="Messages in this session">5 msgs</span>',
  'session list should show the full session message count, not the active-context count',
);

const parts = context.buildSessionMetaParts({ messageCount: 5 });
assert.equal(
  JSON.stringify(parts),
  JSON.stringify([
    '<span>running</span>',
    '<span class="session-item-count" title="Messages in this session">5 msgs</span>',
  ]),
  'session list metadata should keep the compact live status first and the count secondary',
);
assert.equal(state.scopeCalls, 0, 'session list metadata should not render source/app/user scope labels anymore');
assert.equal(state.statusCalls, 1, 'session list metadata should still render the live run status');

console.log('test-chat-session-list-meta: ok');
