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
  'getWorkbenchApiForDisplay',
  'getDisplaySession',
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
  'renderSessionTaskPreviewLineHtml',
  'renderSessionTaskPreviewHtml',
];

const extractedSource = functionNames
  .map((name) => extractFunctionSource(sessionSurfaceUiSource, name))
  .join('\n\n');

const runningSession = {
  id: 'session-running',
  name: 'Untitled',
  autoRenamePending: true,
  taskCard: {
    goal: '旧任务',
    checkpoint: '旧 checkpoint',
  },
};

const liveSessionRecord = {
  ...runningSession,
  taskCard: {
    goal: '修 task card 展示',
    checkpoint: '读取运行态 checkpoint',
  },
};

const context = {
  console,
  sessions: [runningSession],
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
      getSessionRecord(sessionId) {
        return sessionId === runningSession.id ? liveSessionRecord : null;
      },
      applyLiveTaskCardPreview(session) {
        return session?.id === runningSession.id ? liveSessionRecord : session;
      },
      getSnapshot() {
        return { taskClusters: [] };
      },
    },
    MelodySyncSessionListModel: {
      isBranchTaskSession(session) {
        return String(session?.taskCard?.lineRole || '').trim().toLowerCase() === 'branch';
      },
    },
  },
};
context.globalThis = context;
context.window.window = context.window;

vm.runInNewContext(
  `${extractedSource}
globalThis.getPreferredSessionDisplayName = getPreferredSessionDisplayName;
globalThis.getSessionTaskPreview = getSessionTaskPreview;
globalThis.renderSessionTaskPreviewHtml = renderSessionTaskPreviewHtml;`,
  context,
  { filename: 'frontend-src/session/surface-ui.js' },
);

assert.equal(
  context.getPreferredSessionDisplayName(runningSession),
  '修 task card 展示',
  'session rows should resolve their live display name from the running task-card preview',
);

assert.deepEqual(
  JSON.parse(JSON.stringify(context.getSessionTaskPreview(runningSession))),
  {
    summaryLine: '读取运行态 checkpoint',
    summarySegments: [],
    hintLine: '',
    hintSegments: [],
  },
  'session rows should render the running checkpoint from the live task-card preview instead of stale session.taskCard data',
);

assert.match(
  context.renderSessionTaskPreviewHtml(runningSession),
  /读取运行态 checkpoint/,
  'task preview html should expose the live checkpoint text for running sessions',
);

console.log('test-chat-session-surface-live-preview: ok');
