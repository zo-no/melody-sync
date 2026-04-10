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
  'summarizeTaskClusterBranchCounts',
  'looksLikeVisibleTaskTitle',
  'getSessionTaskPreview',
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
    hintLine: '当前子任务：梳理优秀 To-Do 参考',
  },
  'main task rows should expose both the resume checkpoint and the current active branch',
);

const branchPreview = context.getSessionTaskPreview(activeBranchSession);
assert.deepEqual(
  JSON.parse(JSON.stringify(branchPreview)),
  {
    summaryLine: '提炼 Today、分层、快速恢复',
    hintLine: '进行中 · 来自主线：优化任务列表',
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

console.log('test-chat-session-list-task-preview: ok');
