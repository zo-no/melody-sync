#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const source = readFileSync(join(repoRoot, 'static', 'chat', 'session-surface-ui.js'), 'utf8');

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
      if (depth === 0) {
        return code.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

const getResolvedTaskListGroupKeySource = extractFunctionSource(source, 'getResolvedTaskListGroupKey');
const shouldRenderSnapshotBranchAsStandaloneSource = extractFunctionSource(source, 'shouldRenderSnapshotBranchAsStandalone');
const getSidebarTaskClustersSource = extractFunctionSource(source, 'getSidebarTaskClusters');

const context = {
  console,
  snapshot: null,
  buildTaskClusters(sessions = []) {
    return sessions.map((session) => ({ root: session, branches: [] }));
  },
  window: {
    MelodySyncWorkbench: {
      getSnapshot() {
        return context.snapshot;
      },
    },
  },
};
context.globalThis = context;

vm.runInNewContext(`
  const TASK_LIST_GROUPS = [
    { id: "inbox", key: "group:inbox", aliases: ["收集箱", "收件箱", "capture", "inbox"] },
    { id: "long_term", key: "group:long-term", aliases: ["长期任务", "long-term", "long term"] },
    { id: "short_term", key: "group:short-term", aliases: ["短期任务", "short-term", "short term"] },
    { id: "knowledge_base", key: "group:knowledge-base", aliases: ["知识库内容", "knowledge-base", "knowledge base"] },
    { id: "waiting", key: "group:waiting", aliases: ["等待任务", "waiting"] },
  ];
  function resolveTaskListGroup(groupValue = "") {
    const normalized = String(groupValue || "").replace(/\\s+/g, " ").trim().toLowerCase();
    return TASK_LIST_GROUPS.find((entry) => entry.aliases.includes(normalized)) || TASK_LIST_GROUPS[0];
  }
  ${getResolvedTaskListGroupKeySource}
  ${shouldRenderSnapshotBranchAsStandaloneSource}
  ${getSidebarTaskClustersSource}
  globalThis.getSidebarTaskClusters = getSidebarTaskClusters;
`, context, {
  filename: 'static/chat/session-surface-ui.js',
});

const rootSession = { id: 'main', name: '短期任务主线', group: '短期任务' };
const activeBranch = { id: 'active', name: '当前进行中的支线', group: '收集箱' };
const knowledgeBranch = { id: 'knowledge', name: '知识库条目', group: '知识库内容' };

context.snapshot = {
  taskClusters: [
    {
      mainSessionId: 'main',
      currentBranchSessionId: 'active',
      branchSessionIds: ['active', 'knowledge'],
      branchSessions: [
        { id: 'active', _branchStatus: 'active', _branchDepth: 1, _branchParentSessionId: 'main' },
        { id: 'knowledge', _branchStatus: 'resolved', _branchDepth: 2, _branchParentSessionId: 'active' },
      ],
    },
  ],
};

const clusters = context.getSidebarTaskClusters([rootSession, activeBranch, knowledgeBranch]);

assert.equal(clusters.length, 2, 'cross-group resolved knowledge branches should stay visible as standalone roots');
assert.equal(clusters[0]?.root?.id, 'main', 'snapshot cluster should still keep the main root');
assert.deepEqual(
  clusters[0]?.branches?.map((session) => session.id),
  ['active'],
  'current active branches should remain attached to the main cluster',
);
assert.equal(clusters[1]?.root?.id, 'knowledge', 'resolved knowledge branches should fall back to their own root entry');

console.log('test-chat-sidebar-task-clusters: ok');
