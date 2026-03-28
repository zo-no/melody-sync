#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const source = readFileSync(join(repoRoot, 'static', 'chat', 'workbench-ui.js'), 'utf8');

function makeClassList(initial = [], onChange = () => {}) {
  const values = new Set(initial);
  const sync = () => onChange([...values].join(' '));
  return {
    add(...tokens) {
      tokens.filter(Boolean).forEach((token) => values.add(token));
      sync();
    },
    remove(...tokens) {
      tokens.filter(Boolean).forEach((token) => values.delete(token));
      sync();
    },
    contains(token) { return values.has(token); },
    toggle(token, force) {
      if (force === true) {
        values.add(token);
        sync();
        return true;
      }
      if (force === false) {
        values.delete(token);
        sync();
        return false;
      }
      if (values.has(token)) {
        values.delete(token);
        sync();
        return false;
      }
      values.add(token);
      sync();
      return true;
    },
    set(value) {
      values.clear();
      String(value || '').split(/\s+/).filter(Boolean).forEach((token) => values.add(token));
      sync();
    },
  };
}

function makeElement(id = '') {
  let className = '';
  const listeners = new Map();
  const element = {
    id,
    hidden: false,
    textContent: '',
    title: '',
    dataset: {},
    children: [],
    classList: null,
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    querySelector(selector) {
      if (selector === 'h2') return null;
      if (selector === 'p') return null;
      return null;
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    trigger(type, event = {}) {
      const handlers = listeners.get(type) || [];
      const payload = {
        preventDefault() {},
        stopPropagation() {},
        currentTarget: this,
        target: this,
        ...event,
      };
      for (const handler of handlers) {
        handler(payload);
      }
    },
    click() {
      this.trigger('click');
    },
    style: { setProperty() {} },
    getAttribute(name) { return this[name]; },
    removeAttribute(name) { delete this[name]; },
    setAttribute(name, value) { this[name] = value; },
  };
  element.classList = makeClassList([], (value) => {
    className = value;
  });
  Object.defineProperty(element, 'className', {
    get() {
      return className;
    },
    set(value) {
      className = String(value || '').trim();
      element.classList.set(className);
    },
  });
  let innerHTML = '';
  Object.defineProperty(element, 'innerHTML', {
    get() {
      return innerHTML;
    },
    set(value) {
      innerHTML = String(value);
      this.children = [];
    },
  });
  return element;
}

function buildHarness({ currentSession, sessions, snapshot, innerWidth = 0 }) {
  const elements = new Map();
  for (const id of [
    'questTracker',
    'questTrackerLabel',
    'questTrackerTitle',
    'questTrackerBranch',
    'questTrackerBranchLabel',
    'questTrackerBranchTitle',
    'questTrackerNext',
    'questTaskList',
    'questTrackerActions',
    'questTrackerToggleBtn',
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
      innerWidth,
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

async function runScenario({ currentSession, sessions, snapshot, innerWidth = 0 }) {
  const { context, elements, fetchCalls } = buildHarness({ currentSession, sessions, snapshot, innerWidth });
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
    summary: '梳理电影史脉络结构图谱',
    goal: '系统学习电影史',
    mainGoal: '系统学习电影史',
    nextSteps: ['先搭电影史主线框架'],
  },
};

const siblingSession = {
  id: 'session-sibling',
  name: '整理任务分组',
  taskCard: {
    lineRole: 'main',
    goal: '整理任务分组',
    mainGoal: '整理任务分组',
    nextSteps: ['把新任务归入收件箱'],
  },
};

const mainlineBranchPreview = {
  id: 'session-main-branch',
  name: 'Branch · 表现主义',
  sourceContext: { parentSessionId: 'session-main' },
  taskCard: {
    lineRole: 'branch',
    goal: '表现主义',
    mainGoal: '学习电影史',
    nextSteps: ['先把表现主义的关键特征讲清楚'],
  },
};

const { elements: mainElements, fetchCalls: mainFetchCalls } = await runScenario({
  currentSession: mainSession,
  sessions: [mainSession, siblingSession, mainlineBranchPreview],
  snapshot: {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    taskClusters: [
      {
        mainSessionId: 'session-main',
        mainSession,
        mainGoal: '学习电影史',
        currentBranchSessionId: 'session-main-branch',
        branchSessionIds: ['session-main-branch'],
        branchSessions: [mainlineBranchPreview],
      },
      {
        mainSessionId: 'session-sibling',
        mainSession: siblingSession,
        mainGoal: '整理任务分组',
        currentBranchSessionId: '',
        branchSessionIds: [],
        branchSessions: [],
      },
    ],
    skills: [],
    summaries: [],
  },
});

assert.equal(mainElements.get('questTracker').hidden, false, 'tracker should render when a session is attached');
assert.equal(mainElements.get('questTrackerLabel').textContent, '当前任务', 'mainline tracker should present the current task as a compact status strip');
assert.equal(mainElements.get('questTrackerTitle').hidden, false, 'mainline tracker should show the current task title directly');
assert.equal(mainElements.get('questTrackerTitle').textContent, '梳理电影史脉络结构图', 'mainline tracker should prefer the compact summary title and hard-cap it to 10 characters');
assert.equal(mainElements.get('questTrackerBranch').hidden, true, 'mainline tracker should stay focused on the main task even when child tasks exist');
assert.equal(mainElements.get('questTrackerNext').hidden, true, 'mainline tracker should keep the summary hidden before any branch exists');
assert.equal(mainElements.get('questTaskList').hidden, true, 'top strip should no longer render the task list itself');
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
  innerWidth: 390,
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

assert.equal(branchElements.get('questTrackerLabel').textContent, '当前子任务', 'branch tracker should keep focus on the current branch');
assert.equal(branchElements.get('questTrackerTitle').hidden, false, 'branch tracker should keep the branch title visible');
assert.equal(branchElements.get('questTrackerTitle').textContent, '表现主义', 'branch tracker should show the current branch goal');
assert.equal(branchElements.get('questTrackerBranch').hidden, true, 'branch tracker should also hide the parent mainline reference until the tree expands');
assert.equal(branchElements.get('questTrackerNext').hidden, false, 'branch tracker should keep a concise next-step summary');
assert.equal(branchElements.get('questTrackerCloseBtn').textContent, 'close', 'branch tracker should expose a compact close action');
assert.equal(branchElements.get('questTrackerCloseBtn').hidden, false, 'branch tracker should show the finish entry point');
assert.equal(branchElements.get('questTrackerAltBtn').textContent, 'stop', 'branch tracker should expose a compact stop action');
assert.equal(branchElements.get('questTrackerAltBtn').hidden, false, 'branch tracker should show the stop action inline');
assert.equal(branchElements.get('questTrackerBackBtn').hidden, true, 'branch tracker should hide merge action until the finish panel opens');
assert.equal(branchElements.get('questFinishPanel').hidden, true, 'finish panel should stay collapsed by default');
assert.deepEqual(branchFetchCalls, [
  '/api/workbench/sessions/session-branch/tracker',
  '/api/workbench',
], 'branch tracker should also prefer the lightweight tracker payload before the full workbench snapshot');
assert.equal(branchElements.get('questTrackerToggleBtn').hidden, false, 'mobile branch tracker should expose the subtask toggle');
assert.equal(branchElements.get('questTaskList').hidden, true, 'branch state should keep the mind-map collapsed before user interaction');

const nestedBranch = {
  id: 'session-branch-child',
  name: 'Branch · 德国表现主义电影',
  sourceContext: { parentSessionId: 'session-branch' },
  taskCard: {
    lineRole: 'branch',
    goal: '德国表现主义电影',
    mainGoal: '学习电影史',
    nextSteps: ['对比卡里加里博士和诺斯费拉图'],
  },
};

const parkedBranch = {
  id: 'session-branch-parked',
  name: 'Branch · 法国新浪潮',
  sourceContext: { parentSessionId: 'session-main' },
  taskCard: {
    lineRole: 'branch',
    goal: '法国新浪潮',
    mainGoal: '学习电影史',
    nextSteps: ['补充跳切和作者论'],
  },
};

const parkedBranchChild = {
  id: 'session-branch-parked-child',
  name: 'Branch · 作者论',
  sourceContext: { parentSessionId: 'session-branch-parked' },
  taskCard: {
    lineRole: 'branch',
    goal: '作者论',
    mainGoal: '学习电影史',
    nextSteps: ['梳理特吕弗和戈达尔的差异'],
  },
};

const { elements: expandedElements } = await runScenario({
  currentSession: nestedBranch,
  sessions: [mainSession, branchSession, nestedBranch, parkedBranch, parkedBranchChild],
  innerWidth: 390,
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
      {
        sessionId: 'session-branch-child',
        parentSessionId: 'session-branch',
        lineRole: 'branch',
        status: 'active',
        goal: '德国表现主义电影',
        mainGoal: '学习电影史',
        nextStep: '对比卡里加里博士和诺斯费拉图',
      },
    ],
    taskClusters: [
      {
        mainSessionId: 'session-main',
        mainSession,
        currentBranchSessionId: 'session-branch-child',
        branchSessionIds: ['session-branch', 'session-branch-child', 'session-branch-parked', 'session-branch-parked-child'],
        branchSessions: [
          {
            ...branchSession,
            _branchStatus: 'active',
            _branchDepth: 1,
            _branchParentSessionId: 'session-main',
          },
          {
            ...nestedBranch,
            _branchStatus: 'active',
            _branchDepth: 2,
            _branchParentSessionId: 'session-branch',
          },
          {
            ...parkedBranch,
            _branchStatus: 'parked',
            _branchDepth: 1,
            _branchParentSessionId: 'session-main',
          },
          {
            ...parkedBranchChild,
            _branchStatus: 'parked',
            _branchDepth: 2,
            _branchParentSessionId: 'session-branch-parked',
          },
        ],
      },
    ],
    skills: [],
    summaries: [],
  },
});

expandedElements.get('questTrackerToggleBtn').click();
const taskList = expandedElements.get('questTaskList');
assert.equal(taskList.hidden, false, 'clicking the task toggle should expand the tracker mind-map');
assert.equal(taskList.children[0]?.className, 'quest-task-item quest-task-mindmap-root', 'expanded task bar should start with an explicit root node');
assert.equal(taskList.children[1]?.className, 'quest-task-directory', 'expanded task bar should render a vertical directory tree');
assert.equal(taskList.children[1]?.children.length, 2, 'directory tree should show the current root branch first and keep sibling branches collapsed underneath');
assert.equal(taskList.children[1]?.children[0]?.classList.contains('quest-task-directory-item'), true, 'current branch should render as a directory node');
assert.equal(taskList.children[1]?.children[0]?.children[0]?.classList.contains('quest-task-directory-row'), true, 'directory nodes should render as full-width rows');
assert.equal(taskList.children[1]?.children[0]?.children[0]?.children[1]?.children[0]?.textContent, '表现主义', 'the first directory row should keep the current path parent title visible');
assert.equal(taskList.children[1]?.children[0]?.children[0]?.children[2]?.textContent, '当前路径', 'the parent directory row should stay marked as current path');
assert.equal(taskList.children[1]?.children[0]?.children[1]?.className, 'quest-task-directory-children', 'current-path branches should expand downward as nested directory children');
assert.equal(taskList.children[1]?.children[0]?.children[1]?.children[0]?.children[0]?.children[0]?.children[0]?.textContent, '德国表现主义电影', 'deep current branch should render directly under its parent instead of as a horizontal stage');
assert.equal(taskList.children[1]?.children[0]?.children[1]?.children[0]?.children[0]?.children[0]?.children[1]?.textContent, '上级：表现主义', 'deep current branch should still show its direct parent in the directory tree');
assert.equal(taskList.children[1]?.children[0]?.children[1]?.children[0]?.children[0]?.children[1]?.textContent, '当前位置', 'deep current directory row should keep the strongest position label');
assert.equal(taskList.children[1]?.children[1]?.children[0]?.children[1]?.children[0]?.textContent, '法国新浪潮', 'non-current sibling branches should still stay visible in the directory tree');
assert.equal(taskList.children[1]?.children[1]?.children[0]?.children[2]?.textContent, '子任务 1', 'collapsed sibling folders should summarize child count without auto-expanding');

taskList.children[1]?.children[0]?.children[0]?.children[0]?.click();
assert.equal(taskList.children[1]?.children[0]?.children.length, 1, 'collapsing a directory node should hide deeper descendants without reordering sibling rows');

taskList.children[1]?.children[0]?.children[0]?.children[0]?.click();
assert.equal(taskList.children[1]?.children[0]?.children.length, 2, 're-expanding the same directory node should deterministically restore its nested child tree');

console.log('test-chat-workbench-tracker: ok');
