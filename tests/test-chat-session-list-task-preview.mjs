#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const sessionSurfaceUiSource = readFileSync(join(repoRoot, 'frontend-src', 'session', 'surface-ui.js'), 'utf8');

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

const functionNames = [
  'getShortFolder',
  'getFolderLabel',
  'normalizeSessionOrdinal',
  'formatSessionOrdinalBadge',
  'clipTaskLabel',
  'toSingleGoalLabel',
  'getPreferredSessionDisplayName',
  'getSessionDisplayName',
  'normalizeComparableText',
  'getTaskCardList',
  'getTaskMapClustersApi',
  'getWorkbenchSnapshot',
  'getSessionCatalogRecords',
  'getTaskClusters',
  'getTaskClusterForSession',
  'getTaskClusterCurrentBranchSessionId',
  'getTaskClusterCurrentBranchSession',
  'getTaskClusterParentSession',
  'getTaskBranchStatusLabel',
  'getTaskBranchStatusClassName',
  'getTaskClusterBranchCountEntries',
  'summarizeTaskClusterBranchCounts',
  'looksLikeVisibleTaskTitle',
  'getSessionTaskPreview',
  'renderSessionTaskPreviewLineHtml',
  'renderSessionTaskPreviewHtml',
];

const extractedSource = functionNames
  .map((name) => extractFunctionSource(sessionSurfaceUiSource, name))
  .join('\n\n');

const mainSession = {
  id: 'main-1',
  name: '优化任务列表',
  taskCard: {
    mainGoal: '优化任务列表',
    checkpoint: '把默认态变成任务恢复视图',
  },
};

const activeBranchSession = {
  id: 'branch-1',
  name: '梳理优秀 To-Do 参考',
  taskCard: {
    goal: '梳理优秀 To-Do 参考',
    checkpoint: '提炼 Today、分层、快速恢复',
    lineRole: 'branch',
  },
  sourceContext: {
    parentSessionId: 'main-1',
  },
  _branchParentSessionId: 'main-1',
};

const parkedBranchSession = {
  id: 'branch-2',
  name: '补充动效细节',
  taskCard: {
    goal: '补充动效细节',
    lineRole: 'branch',
  },
  sourceContext: {
    parentSessionId: 'main-1',
  },
  _branchParentSessionId: 'main-1',
};

const taskCluster = {
  id: 'cluster:main-1',
  mainSessionId: 'main-1',
  mainSession,
  currentBranchSessionId: 'branch-1',
  branchSessionIds: ['branch-1', 'branch-2'],
  branchSessions: [
    { ...activeBranchSession, _branchStatus: 'active' },
    { ...parkedBranchSession, _branchStatus: 'parked' },
  ],
};

const context = {
  console,
  sessions: [mainSession, activeBranchSession, parkedBranchSession],
  esc(value) {
    return String(value || '');
  },
  t(key) {
    if (key === 'session.defaultName') return 'Untitled';
    return key;
  },
  window: {
    MelodySyncTaskMapClusters: {
      getClusterList(snapshot) {
        return snapshot?.taskClusters || [];
      },
    },
    MelodySyncWorkbench: {
      getSnapshot() {
        return {
          taskClusters: [taskCluster],
        };
      },
    },
    MelodySyncSessionListModel: {
      isBranchTaskSession(session) {
        return String(session?.taskCard?.lineRole || '').trim().toLowerCase() === 'branch';
      },
      getBranchTaskStatus(session) {
        if (session?.id === 'branch-2') return 'parked';
        return 'active';
      },
    },
  },
};
context.globalThis = context;

vm.runInNewContext(
  `${extractedSource}
globalThis.getSessionTaskPreview = getSessionTaskPreview;
globalThis.renderSessionTaskPreviewHtml = renderSessionTaskPreviewHtml;
globalThis.summarizeTaskClusterBranchCounts = summarizeTaskClusterBranchCounts;`,
  context,
  { filename: 'frontend-src/session/surface-ui.js' },
);

const mainPreview = context.getSessionTaskPreview(mainSession);
assert.deepEqual(
  JSON.parse(JSON.stringify(mainPreview)),
  {
    summaryLine: '把默认态变成任务恢复视图',
    summarySegments: [],
    hintLine: '当前子任务：梳理优秀 To-Do 参考',
    hintSegments: [],
  },
  'main task rows should expose both the resume checkpoint and the current active branch',
);

const branchPreview = context.getSessionTaskPreview(activeBranchSession);
assert.deepEqual(
  JSON.parse(JSON.stringify(branchPreview)),
  {
    summaryLine: '提炼 Today、分层、快速恢复',
    summarySegments: [],
    hintLine: '进行中 · 来自主线：优化任务列表',
    hintSegments: [
      {
        variant: 'status',
        text: '进行中',
        className: 'status-running',
      },
      {
        variant: 'text',
        text: '来自主线：优化任务列表',
      },
    ],
  },
  'branch task rows should expose their checkpoint and mainline source',
);

const countSummary = context.summarizeTaskClusterBranchCounts(
  { ...taskCluster, currentBranchSessionId: '' },
  'main-1',
);
assert.equal(
  countSummary,
  '进行中 1 · 挂起 1',
  'cluster summaries should fall back to compact branch status counts when there is no active branch focus',
);

const previewHtml = context.renderSessionTaskPreviewHtml(mainSession);
assert.match(previewHtml, /session-item-summary/, 'task preview html should render a summary row');
assert.match(previewHtml, /session-item-hint/, 'task preview html should render a hint row');
assert.match(previewHtml, /当前子任务：梳理优秀 To-Do 参考/, 'task preview html should include the active branch hint');

const branchPreviewHtml = context.renderSessionTaskPreviewHtml(activeBranchSession);
assert.match(branchPreviewHtml, /task-branch-status status-running/, 'branch preview html should expose the running status chip class');
assert.match(branchPreviewHtml, /来自主线：优化任务列表/, 'branch preview html should keep the mainline source copy next to the status chip');

taskCluster.currentBranchSessionId = '';
const previousCheckpoint = mainSession.taskCard.checkpoint;
mainSession.taskCard.checkpoint = '';
const idleMainPreview = context.getSessionTaskPreview(mainSession);
assert.deepEqual(
  JSON.parse(JSON.stringify(idleMainPreview.summarySegments)),
  [
    {
      variant: 'status',
      text: '进行中 1',
      className: 'status-running',
    },
    {
      variant: 'status',
      text: '挂起 1',
      className: 'status-parked',
    },
  ],
  'main task summaries should carry per-status chip metadata when only branch counts remain',
);
const idleMainPreviewHtml = context.renderSessionTaskPreviewHtml(mainSession);
assert.match(idleMainPreviewHtml, /task-branch-status status-running/, 'main task summary html should render the running count chip');
assert.match(idleMainPreviewHtml, /task-branch-status status-parked/, 'main task summary html should render the parked count chip');
mainSession.taskCard.checkpoint = previousCheckpoint;
taskCluster.currentBranchSessionId = 'branch-1';

const queueFunctionNames = [
  'formatQueuedMessageTimestamp',
  'isMessagesViewportNearBottom',
  'getQueuedPanelAnchorKey',
  'preserveQueuedPanelBottomAnchor',
  'renderQueuedMessagePanel',
];

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...tokens) {
      tokens.forEach((token) => values.add(token));
    },
    remove(...tokens) {
      tokens.forEach((token) => values.delete(token));
    },
    contains(token) {
      return values.has(token);
    },
  };
}

function createDomElement(tagName = 'div') {
  const element = {
    tagName: String(tagName).toUpperCase(),
    className: '',
    textContent: '',
    children: [],
    dataset: {},
    classList: makeClassList(),
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
  let innerHtml = '';
  Object.defineProperty(element, 'innerHTML', {
    get() {
      return innerHtml;
    },
    set(value) {
      innerHtml = String(value);
      this.children = [];
    },
  });
  return element;
}

const queueContext = {
  console,
  currentSessionId: 'main-1',
  messageTimeFormatter: {
    format() {
      return '10:00';
    },
  },
  queuedPanel: createDomElement('div'),
  messagesEl: {
    scrollTop: 640,
    scrollHeight: 1000,
    clientHeight: 360,
  },
  document: {
    createElement(tagName) {
      return createDomElement(tagName);
    },
  },
  getSessionActivity(session) {
    return session?.activity || {
      run: { state: 'idle' },
      compact: { state: 'idle' },
    };
  },
  getAttachmentDisplayName(image) {
    return image?.name || '';
  },
  t(key, vars = {}) {
    if (key === 'queue.single') return '1 follow-up queued';
    if (key === 'queue.multiple') return `${vars.count} follow-ups queued`;
    if (key === 'queue.note.afterRun') return 'after run';
    if (key === 'queue.note.preparing') return 'preparing';
    if (key === 'queue.timestamp.default') return 'queued';
    if (key === 'queue.timestamp.withTime') return `queued at ${vars.time}`;
    if (key === 'queue.attachmentOnly') return 'attachment only';
    if (key === 'queue.attachments') return `attachments: ${vars.names}`;
    if (key === 'queue.olderHidden.one') return '1 older hidden';
    if (key === 'queue.olderHidden.multiple') return `${vars.count} older hidden`;
    return key;
  },
};
let scrollToBottomCalls = 0;
queueContext.scrollToBottom = () => {
  scrollToBottomCalls += 1;
  queueContext.messagesEl.scrollTop = queueContext.messagesEl.scrollHeight;
};
queueContext.globalThis = queueContext;

vm.runInNewContext(
  queueFunctionNames
    .map((name) => extractFunctionSource(sessionSurfaceUiSource, name))
    .join('\n\n')
    + '\n\nglobalThis.renderQueuedMessagePanel = renderQueuedMessagePanel;',
  queueContext,
  { filename: 'frontend-src/session/surface-ui.js' },
);

const queuedSession = {
  id: 'main-1',
  queuedMessages: [
    { requestId: 'req-1', queuedAt: '2026-04-10T10:00:00.000Z', text: 'follow-up one', images: [] },
  ],
  activity: {
    run: { state: 'running' },
    compact: { state: 'idle' },
  },
};

queueContext.renderQueuedMessagePanel(queuedSession);
assert.equal(
  scrollToBottomCalls,
  1,
  'queue panel should preserve the transcript bottom anchor when a new queued follow-up appears near the bottom',
);
assert.equal(
  queueContext.messagesEl.scrollTop,
  queueContext.messagesEl.scrollHeight,
  'queue panel anchoring should keep the latest streamed content visible',
);
assert.equal(
  queueContext.queuedPanel.classList.contains('visible'),
  true,
  'queue panel should become visible for the current session when queued follow-ups exist',
);

scrollToBottomCalls = 0;
queueContext.messagesEl.scrollTop = 700;
queueContext.messagesEl.clientHeight = 300;
queueContext.messagesEl.scrollHeight = 1000;
queueContext.renderQueuedMessagePanel(queuedSession);
assert.equal(
  scrollToBottomCalls,
  0,
  'queue panel refreshes should not keep snapping the viewport when the queued payload has not changed',
);
assert.equal(
  queueContext.messagesEl.scrollTop,
  700,
  'unchanged queue renders should preserve the user scroll position',
);

scrollToBottomCalls = 0;
queueContext.messagesEl.scrollTop = 120;
queueContext.messagesEl.clientHeight = 300;
queueContext.messagesEl.scrollHeight = 1000;
queueContext.renderQueuedMessagePanel({
  ...queuedSession,
  queuedMessages: [
    queuedSession.queuedMessages[0],
    { requestId: 'req-2', queuedAt: '2026-04-10T10:01:00.000Z', text: 'follow-up two', images: [] },
  ],
});
assert.equal(
  scrollToBottomCalls,
  0,
  'queue panel updates should not steal scroll when the user is reading away from the bottom',
);
assert.equal(
  queueContext.messagesEl.scrollTop,
  120,
  'queue panel updates should leave mid-transcript readers in place',
);

console.log('test-chat-session-list-task-preview: ok');
