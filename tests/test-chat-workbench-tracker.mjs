#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const source = readFileSync(join(repoRoot, 'static', 'chat', 'workbench-ui.js'), 'utf8');

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...tokens) { tokens.filter(Boolean).forEach((token) => values.add(token)); },
    remove(...tokens) { tokens.filter(Boolean).forEach((token) => values.delete(token)); },
    contains(token) { return values.has(token); },
    toggle(token, force) {
      if (force === true) return values.add(token), true;
      if (force === false) return values.delete(token), false;
      if (values.has(token)) return values.delete(token), false;
      values.add(token);
      return true;
    },
  };
}

function makeElement(id = '') {
  return {
    id,
    hidden: false,
    textContent: '',
    title: '',
    dataset: {},
    children: [],
    classList: makeClassList(),
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    querySelector(selector) {
      if (selector === 'h2') return null;
      if (selector === 'p') return null;
      return null;
    },
    addEventListener() {},
    removeAttribute(name) { delete this[name]; },
    setAttribute(name, value) { this[name] = value; },
  };
}

function buildHarness({ currentSession, sessions, snapshot }) {
  const elements = new Map();
  for (const id of [
    'questTracker',
    'questTrackerLabel',
    'questTrackerTitle',
    'questTrackerBranch',
    'questTrackerBranchLabel',
    'questTrackerBranchTitle',
    'questTrackerNext',
    'questTrackerCloseBtn',
    'questTrackerAltBtn',
    'questTrackerBackBtn',
    'questFinishPanel',
    'questFinishResolveBtn',
    'questFinishParkBtn',
    'questFinishMergeBtn',
    'emptyState',
  ]) {
    elements.set(id, makeElement(id));
  }

  const fetchCalls = [];
  const context = {
    console,
    window: {
      sessions,
      addEventListener() {},
      setTimeout(fn) {
        fn();
        return 1;
      },
    },
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      },
      addEventListener() {},
      createElement() {
        return makeElement();
      },
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    emptyState: elements.get('emptyState'),
    sessions,
    getCurrentSession() {
      return currentSession;
    },
    fetchJsonOrRedirect: async (url) => {
      fetchCalls.push(url);
      return snapshot;
    },
    renderSessionList() {},
    attachSession() {},
  };
  context.globalThis = context;
  return { context, elements, fetchCalls };
}

async function runScenario({ currentSession, sessions, snapshot }) {
  const { context, elements, fetchCalls } = buildHarness({ currentSession, sessions, snapshot });
  await vm.runInNewContext(`(async () => { ${source}\nawait Promise.resolve(); })();`, context, {
    filename: 'static/chat/workbench-ui.js',
  });
  await Promise.resolve();
  await Promise.resolve();
  return { elements, fetchCalls };
}

const mainSession = {
  id: 'session-main',
  name: 'Placeholder session name',
  taskCard: {
    lineRole: 'main',
    goal: '学习电影史',
    mainGoal: '学习电影史',
    nextSteps: ['先搭电影史主线框架'],
  },
};

const { elements: mainElements, fetchCalls: mainFetchCalls } = await runScenario({
  currentSession: mainSession,
  sessions: [mainSession],
  snapshot: {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    taskClusters: [],
    skills: [],
    summaries: [],
  },
});

assert.equal(mainElements.get('questTracker').hidden, false, 'tracker should render when a session is attached');
assert.equal(mainElements.get('questTrackerLabel').textContent, '主线任务', 'mainline tracker should stay minimal before any branch exists');
assert.equal(mainElements.get('questTrackerTitle').textContent, '学习电影史', 'mainline tracker should only show the current main goal');
assert.equal(mainElements.get('questTrackerBranch').hidden, true, 'mainline tracker should not expose branch structure before any branch exists');
assert.equal(mainElements.get('questTrackerNext').hidden, true, 'mainline tracker should keep the summary hidden before any branch exists');
assert.deepEqual(mainFetchCalls, [
  '/api/workbench/sessions/session-main/tracker',
  '/api/workbench',
], 'tracker should fetch the lightweight session tracker snapshot before the full workbench snapshot');

const branchSession = {
  id: 'session-branch',
  name: 'Branch · 表现主义',
  sourceContext: { parentSessionId: 'session-main' },
  taskCard: {
    lineRole: 'branch',
    goal: '表现主义',
    mainGoal: '学习电影史',
    nextSteps: ['先把表现主义的关键特征讲清楚'],
  },
};

const { elements: branchElements, fetchCalls: branchFetchCalls } = await runScenario({
  currentSession: branchSession,
  sessions: [mainSession, branchSession],
  snapshot: {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [
      {
        sessionId: 'session-branch',
        parentSessionId: 'session-main',
        lineRole: 'branch',
        status: 'active',
        goal: '表现主义',
        mainGoal: '学习电影史',
        nextStep: '先把表现主义的关键特征讲清楚',
      },
    ],
    taskClusters: [
      {
        mainSessionId: 'session-main',
        currentBranchSessionId: 'session-branch',
        branchSessionIds: ['session-branch'],
        branchSessions: [
          {
            id: 'session-branch',
            name: 'Branch · 表现主义',
            _branchStatus: 'active',
            _branchDepth: 1,
            _branchParentSessionId: 'session-main',
            taskCard: {
              goal: '表现主义',
              mainGoal: '学习电影史',
              lineRole: 'branch',
              nextSteps: ['先把表现主义的关键特征讲清楚'],
            },
          },
        ],
      },
    ],
    skills: [],
    summaries: [],
  },
});

assert.equal(branchElements.get('questTrackerLabel').textContent, '当前任务', 'branch tracker should stay focused on the current target');
assert.equal(branchElements.get('questTrackerTitle').textContent, '表现主义', 'branch tracker should focus on the current branch goal');
assert.equal(branchElements.get('questTrackerBranch').hidden, true, 'branch tracker should hide the task structure details');
assert.equal(branchElements.get('questTrackerNext').hidden, true, 'branch tracker should hide verbose next-step summaries');
assert.equal(branchElements.get('questTrackerCloseBtn').textContent, '结束子任务', 'branch tracker should expose a single finish entry point');
assert.equal(branchElements.get('questTrackerCloseBtn').hidden, false, 'branch tracker should show the finish entry point');
assert.equal(branchElements.get('questTrackerAltBtn').hidden, true, 'branch tracker should hide direct lifecycle buttons behind the finish panel');
assert.equal(branchElements.get('questTrackerBackBtn').hidden, true, 'branch tracker should hide merge action until the finish panel opens');
assert.equal(branchElements.get('questFinishPanel').hidden, true, 'finish panel should stay collapsed by default');
assert.deepEqual(branchFetchCalls, [
  '/api/workbench/sessions/session-branch/tracker',
  '/api/workbench',
], 'branch tracker should also prefer the lightweight tracker payload before the full workbench snapshot');

console.log('test-chat-workbench-tracker: ok');
