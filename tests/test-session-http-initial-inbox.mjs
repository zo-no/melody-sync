#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const source = readFileSync(join(repoRoot, 'static', 'frontend', 'session/http.js'), 'utf8');

function extractFunctionSource(code, functionName) {
  const marker = `function ${functionName}`;
  const asyncMarker = `async function ${functionName}`;
  const start = code.indexOf(asyncMarker) !== -1 ? code.indexOf(asyncMarker) : code.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const bodyStart = code.indexOf('{', start);
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

const snippet = [
  'let initialInboxSessionPromise = null;',
  extractFunctionSource(source, 'getInitialInboxSessionName'),
  extractFunctionSource(source, 'getInboxGroupLabel'),
  extractFunctionSource(source, 'getPreferredSessionCreationTool'),
  extractFunctionSource(source, 'ensureInitialInboxSession'),
  extractFunctionSource(source, 'fetchSessionsList'),
].join('\n\n');

const fetchCalls = [];
const appliedStates = [];
const attached = [];
const sidebarCollapseCalls = [];
let taskMapCloseCalls = 0;
const layoutPasses = [];

const context = {
  console,
  SESSION_LIST_URL: '/api/sessions',
  preferredTool: '',
  selectedTool: 'codex',
  toolsList: [],
  DEFAULT_TOOL_ID: 'codex',
  DEFAULT_APP_ID: 'chat',
  DEFAULT_APP_NAME: 'Chat',
  currentSessionId: '',
  sessions: [],
  window: {
    MelodySyncWorkbench: {
      closeTaskMapDrawer() {
        taskMapCloseCalls += 1;
      },
    },
    melodySyncT(key) {
      return {
        'sidebar.bootstrapSession': '初始化任务',
        'sidebar.group.inbox': '收集箱',
      }[key] || key;
    },
  },
  setSidebarCollapsed(collapsed) {
    sidebarCollapseCalls.push(collapsed);
  },
  requestLayoutPass(reason) {
    layoutPasses.push(reason);
  },
  fetchJsonOrRedirect: async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (url === '/api/sessions' && !options.method) {
      return { sessions: [], archivedCount: 0 };
    }
    if (url === '/api/sessions' && options.method === 'POST') {
      return {
        session: {
          id: 'seed-session',
          name: '初始化任务',
          group: '收集箱',
        },
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  },
  applySessionListState(nextSessions, meta) {
    appliedStates.push({ nextSessions, meta });
    context.sessions = nextSessions;
  },
  attachSession(sessionId, session) {
    attached.push({ sessionId, session });
    context.currentSessionId = sessionId;
  },
};
context.globalThis = context;

vm.runInNewContext(`${snippet}\nglobalThis.fetchSessionsList = fetchSessionsList;`, context, {
  filename: 'frontend-src/session/http.js',
});

await context.fetchSessionsList();

assert.deepEqual(
  fetchCalls.map((entry) => entry.url),
  ['/api/sessions', '/api/sessions'],
  'empty session lists should trigger a follow-up create request for the inbox seed task',
);

const createPayload = JSON.parse(fetchCalls[1].options.body);
assert.equal(createPayload.name, '初始化任务', 'seed task should use the dedicated bootstrap task title');
assert.equal(createPayload.group, '收集箱', 'seed task should be created inside the inbox group');
assert.equal(createPayload.tool, 'codex', 'seed task should fall back to the preferred creation tool');

assert.equal(appliedStates.length, 1, 'seed task should replace the empty session list with a real applied state');
assert.equal(appliedStates[0].nextSessions[0]?.id, 'seed-session', 'seeded session should become the active list entry');
assert.equal(attached[0]?.sessionId, 'seed-session', 'seed task should auto-attach when no current session is selected');
assert.deepEqual(sidebarCollapseCalls, [true], 'seeding the first task should collapse the task list by default');
assert.equal(taskMapCloseCalls, 1, 'seeding the first task should also collapse the task map by default');
assert.deepEqual(layoutPasses, ['seed-session-layout'], 'seeding the first task should request a layout pass for the centered workspace');

console.log('test-session-http-initial-inbox: ok');
