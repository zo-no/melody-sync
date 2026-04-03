#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const nodeContractSource = readFileSync(join(repoRoot, 'static', 'chat', 'workbench/node-contract.js'), 'utf8');
const taskMapModelSource = readFileSync(join(repoRoot, 'static', 'chat', 'workbench/task-map-model.js'), 'utf8');
const questStateSource = readFileSync(join(repoRoot, 'static', 'chat', 'workbench', 'quest-state.js'), 'utf8');
const taskTrackerUiSource = readFileSync(join(repoRoot, 'static', 'chat', 'workbench', 'task-tracker-ui.js'), 'utf8');
const taskMapUiSource = readFileSync(join(repoRoot, 'static', 'chat', 'workbench', 'task-map-ui.js'), 'utf8');
const taskListUiSource = readFileSync(join(repoRoot, 'static', 'chat', 'workbench', 'task-list-ui.js'), 'utf8');
const branchActionsSource = readFileSync(join(repoRoot, 'static', 'chat', 'workbench', 'branch-actions.js'), 'utf8');
const operationRecordUiSource = readFileSync(join(repoRoot, 'static', 'chat', 'workbench', 'operation-record-ui.js'), 'utf8');
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

function buildHarness({ currentSession, sessions, snapshot, innerWidth = 0, fetchResponder = null }) {
  const elements = new Map();
  for (const id of [
    'questTracker',
    'questTrackerStatus',
    'questTrackerStatusDot',
    'questTrackerStatusText',
    'questTrackerLabel',
    'questTrackerTitle',
    'questTrackerBranch',
    'questTrackerBranchLabel',
    'questTrackerBranchTitle',
    'questTrackerNext',
    'questTrackerFooter',
    'questTaskList',
    'taskMapRail',
    'taskMapDrawerBtn',
    'taskMapDrawerBackdrop',
    'questTrackerActions',
    'questTrackerToggleBtn',
    'questTrackerCloseBtn',
    'questTrackerAltBtn',
    'questTrackerBackBtn',
    'questFinishPanel',
    'questFinishResolveBtn',
    'questFinishParkBtn',
    'questFinishMergeBtn',
    'questFinishSummaryInput',
    'operationRecordBtn',
    'operationRecordRail',
    'operationRecordBackdrop',
    'operationRecordCloseBtn',
    'operationRecordInner',
    'emptyState',
  ]) {
    elements.set(id, makeElement(id));
  }

  const fetchCalls = [];
  const fetchLog = [];
  const attachCalls = [];
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
      body: makeElement('body'),
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
    fetchJsonOrRedirect: async (url, options = {}) => {
      fetchCalls.push(url);
      fetchLog.push({ url, options });
      if (typeof fetchResponder === 'function') {
        return fetchResponder(url, options, { snapshot, sessions, elements });
      }
      return snapshot;
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push(url);
      fetchLog.push({ url, options });
      let payload = snapshot;
      if (typeof fetchResponder === 'function') {
        payload = await fetchResponder(url, options, { snapshot, sessions, elements });
      }
      return {
        ok: true,
        async json() {
          return payload;
        },
      };
    },
    renderSessionList() {},
    attachSession(id, session) {
      attachCalls.push({ id, session });
    },
  };
  context.window.fetch = context.fetch;
  context.globalThis = context;
  return { context, elements, fetchCalls, fetchLog, attachCalls };
}

async function runScenario({ currentSession, sessions, snapshot, innerWidth = 0, fetchResponder = null }) {
  const { context, elements, fetchCalls, fetchLog, attachCalls } = buildHarness({ currentSession, sessions, snapshot, innerWidth, fetchResponder });
  await vm.runInNewContext(`(async () => { ${nodeContractSource}\n${taskMapModelSource}\n${questStateSource}\n${taskTrackerUiSource}\n${taskMapUiSource}\n${taskListUiSource}\n${branchActionsSource}\n${operationRecordUiSource}\n${source}\nawait Promise.resolve(); })();`, context, {
    filename: 'static/chat/workbench-ui.js',
  });
  await Promise.resolve();
  await Promise.resolve();
  return { elements, fetchCalls, fetchLog, attachCalls, workbench: context.window.MelodySyncWorkbench };
}

async function flushAsync(turns = 6) {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

function findFirstByClass(node, className) {
  if (!node) return null;
  if (node.classList?.contains(className)) return node;
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const match = findFirstByClass(child, className);
    if (match) return match;
  }
  return null;
}

function findAllByClass(node, className, results = []) {
  if (!node) return results;
  if (node.classList?.contains(className)) results.push(node);
  for (const child of Array.isArray(node.children) ? node.children : []) {
    findAllByClass(child, className, results);
  }
  return results;
}

function getFlowNodeTitles(rootNode) {
  return findAllByClass(rootNode, 'quest-task-flow-node').map((node) => (
    findFirstByClass(node, 'quest-task-flow-node-title')?.textContent || ''
  ));
}

const mainSession = {
  id: 'session-main',
  name: '系统学习电影史',
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
    nextSteps: ['把新任务归入收集箱'],
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
  _branchDepth: 1,
  _branchParentSessionId: 'session-main',
  _branchStatus: 'active',
};

const { elements: mainElements, fetchCalls: mainFetchCalls, attachCalls: mainAttachCalls } = await runScenario({
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
assert.equal(mainElements.get('questTrackerLabel').textContent, '', 'mainline tracker should not render an extra task-bar label');
assert.equal(mainElements.get('questTrackerStatus').hidden, false, 'mainline tracker should render the task status inside the task bar');
assert.equal(mainElements.get('questTrackerStatusText').textContent, '空闲', 'idle mainline tasks should surface an idle status inside the task bar');
assert.equal(mainElements.get('questTrackerTitle').hidden, false, 'mainline tracker should show the current task title directly');
assert.equal(mainElements.get('questTrackerTitle').textContent, '系统学习电影史', 'mainline tracker should show the main task title before any supporting detail');
assert.equal(mainElements.get('questTrackerBranch').hidden, false, 'mainline tracker should keep one supporting detail block directly under the title');
assert.equal(mainElements.get('questTrackerBranchTitle').textContent, '先搭电影史主线框架', 'mainline tracker should place the current task detail under the title');
assert.equal(mainElements.get('questTrackerNext').hidden, true, 'mainline tracker should avoid duplicating the same detail block');
assert.equal(mainElements.get('taskMapRail').hidden, false, 'desktop task manager should keep the task map rail visible');
assert.equal(mainElements.get('questTaskList').hidden, false, 'desktop task manager should render the task map by default');
assert.equal(mainElements.get('questTaskList').classList.contains('is-flow-board'), true, 'task-map mounts should route scrolling through the dedicated flow-board surface');
assert.equal(Boolean(findFirstByClass(mainElements.get('questTaskList'), 'quest-task-flow-shell')), true, 'desktop task map should render as a dedicated flow board');
assert.deepEqual(mainFetchCalls, [
  '/api/workbench/sessions/session-main/tracker',
  '/api/workbench',
], 'tracker should fetch the lightweight session tracker snapshot before the full workbench snapshot');
findAllByClass(mainElements.get('questTaskList'), 'quest-task-flow-node')
  .find((node) => findFirstByClass(node, 'quest-task-flow-node-title')?.textContent === '表现主义')
  ?.click();
assert.deepEqual(
  mainAttachCalls.map((entry) => entry.id),
  ['session-main-branch'],
  'clicking an existing flow node should still switch the workspace to that branch session',
);

const candidateOnlyMain = {
  id: 'session-main-candidate-only',
  name: '为用户搭出一条兼顾电影史主线与美术史兴趣维度的学习路线',
  taskCard: {
    lineRole: 'main',
    goal: '为用户搭出一条兼顾电影史主线与美术史兴趣维度的学习路线',
    mainGoal: '为用户搭出一条兼顾电影史主线与美术史兴趣维度的学习路线',
    checkpoint: '先明确主线骨架，再判断哪些方向值得拆成支线',
    candidateBranches: ['改成视觉风格线', '生成12周片单'],
  },
};

const { elements: candidateOnlyElements } = await runScenario({
  currentSession: candidateOnlyMain,
  sessions: [candidateOnlyMain],
  snapshot: {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    taskClusters: [
      {
        mainSessionId: 'session-main-candidate-only',
        mainSession: candidateOnlyMain,
        mainGoal: candidateOnlyMain.taskCard.mainGoal,
        currentBranchSessionId: '',
        branchSessionIds: [],
        branchSessions: [],
      },
    ],
    skills: [],
    summaries: [],
  },
});

const candidateOnlyBoard = findFirstByClass(candidateOnlyElements.get('questTaskList'), 'quest-task-flow-shell');
assert.equal(Boolean(candidateOnlyBoard), true, 'candidate-only quests should still render inside the same flow board');
assert.equal(findAllByClass(candidateOnlyBoard, 'quest-task-flow-node').length >= 3, true, 'candidate-only quests should render the root node plus candidate side quests');
assert.equal(findFirstByClass(candidateOnlyBoard, 'quest-task-flow-node-action')?.textContent, '开启支线', 'candidate-only suggestion nodes should expose an explicit branch-entry action');
assert.equal(candidateOnlyElements.get('questTrackerTitle').textContent, '为用户搭出一条兼顾电影史主线与美术史兴趣维度的学习路线', 'mainline tracker should keep the fixed session task title as the top-level anchor');
assert.equal(candidateOnlyElements.get('questTrackerBranchTitle').textContent, '先明确主线骨架，再判断哪些方向值得拆成支线', 'mainline tracker should use the stable checkpoint as the task-progress detail when no next step exists yet');
assert.equal(candidateOnlyElements.get('questTrackerNext').textContent, '发现 2 条建议支线', 'mainline tracker should surface candidate branch discovery as a separate secondary hint');

const openedCandidateBranch = {
  id: 'session-main-candidate-branch',
  name: 'Branch · 改成视觉风格线',
  sourceContext: { parentSessionId: 'session-main-candidate-only' },
  taskCard: {
    lineRole: 'branch',
    goal: '改成视觉风格线',
    mainGoal: candidateOnlyMain.taskCard.mainGoal,
    nextSteps: ['先按视觉风格重新组织主线'],
  },
};

const { elements: candidateOpenElements, fetchLog: candidateOpenFetchLog, attachCalls: candidateOpenAttachCalls } = await runScenario({
  currentSession: candidateOnlyMain,
  sessions: [candidateOnlyMain],
  snapshot: {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    taskClusters: [
      {
        mainSessionId: 'session-main-candidate-only',
        mainSession: candidateOnlyMain,
        mainGoal: candidateOnlyMain.taskCard.mainGoal,
        currentBranchSessionId: '',
        branchSessionIds: [],
        branchSessions: [],
      },
    ],
    skills: [],
    summaries: [],
  },
  fetchResponder: async (url, options, { snapshot }) => {
    if (options?.method === 'POST' && url === '/api/workbench/sessions/session-main-candidate-only/branches') {
      return {
        session: openedCandidateBranch,
        snapshot,
      };
    }
    return snapshot;
  },
});

findFirstByClass(candidateOpenElements.get('questTaskList'), 'quest-task-flow-node-action')?.click();
await flushAsync();
assert.equal(
  candidateOpenFetchLog.some((entry) => (
    entry.url === '/api/workbench/sessions/session-main-candidate-only/branches'
    && entry.options?.method === 'POST'
    && JSON.parse(entry.options?.body || '{}').goal === '改成视觉风格线'
  )),
  true,
  'clicking a candidate suggestion should open a real branch through the existing branch-creation endpoint',
);
assert.deepEqual(
  candidateOpenAttachCalls.map((entry) => entry.id),
  ['session-main-candidate-branch'],
  'opening a candidate suggestion should attach the newly created branch session into the main workspace flow',
);

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

assert.equal(branchElements.get('questTrackerLabel').textContent, '', 'branch tracker should not render an extra task-bar label');
assert.equal(branchElements.get('questTrackerTitle').hidden, false, 'branch tracker should keep the branch title visible');
assert.equal(branchElements.get('questTrackerTitle').textContent, '表现主义', 'branch tracker should show the current branch goal');
assert.equal(branchElements.get('questTrackerBranch').hidden, false, 'branch tracker should show the parent mainline reference inside the task bar');
assert.equal(branchElements.get('questTrackerBranchLabel').textContent, '主线任务', 'branch tracker should treat the secondary line as the parent mainline anchor');
assert.equal(branchElements.get('questTrackerBranchTitle').textContent, '来自主线：学习电影史', 'branch tracker should surface the parent mainline as the first detail line');
assert.equal(branchElements.get('questTrackerNext').hidden, false, 'branch tracker should keep a concise next-step summary');
assert.equal(branchElements.get('questTrackerCloseBtn').textContent, '收束支线', 'branch tracker should expose a compact finish action');
assert.equal(branchElements.get('questTrackerCloseBtn').hidden, false, 'branch tracker should show the finish entry point');
assert.equal(branchElements.get('questTrackerAltBtn').textContent, '挂起', 'branch tracker should expose a compact park action');
assert.equal(branchElements.get('questTrackerAltBtn').hidden, false, 'branch tracker should show the stop action inline');
assert.equal(branchElements.get('questTrackerBackBtn').hidden, true, 'active branch tracker should keep the reopen action hidden');
assert.deepEqual(branchFetchCalls, [
  '/api/workbench/sessions/session-branch/tracker',
  '/api/workbench',
], 'branch tracker should also prefer the lightweight tracker payload before the full workbench snapshot');
assert.equal(branchElements.get('questTrackerStatus').hidden, false, 'mobile branch tracker should render the task status inside the task bar');
assert.equal(branchElements.get('taskMapDrawerBtn').hidden, false, 'mobile branch tracker should expose the header task-map drawer toggle');
assert.equal(branchElements.get('questTrackerToggleBtn').hidden, true, 'mobile branch tracker should stop rendering the old inline task-map toggle');
assert.equal(branchElements.get('taskMapRail').hidden, false, 'mobile branch tracker should keep the task map drawer mounted off-canvas');
assert.equal(branchElements.get('taskMapDrawerBackdrop').hidden, true, 'mobile branch tracker should keep the drawer backdrop hidden while collapsed');
assert.equal(branchElements.get('taskMapRail').classList.contains('is-mobile-open'), false, 'mobile task map drawer should stay collapsed by default');
assert.equal(branchElements.get('questTaskList').hidden, false, 'branch state should keep the mind-map rendered inside the drawer even before interaction');

const mergeableBranchSession = {
  id: 'session-branch-merge',
  name: 'Branch · 表现主义',
  sourceContext: { parentSessionId: 'session-main' },
  taskCard: {
    lineRole: 'branch',
    goal: '表现主义',
    mainGoal: '学习电影史',
    checkpoint: '先把表现主义的关键特征讲清楚',
    nextSteps: ['先把表现主义的关键特征讲清楚'],
  },
};

const { elements: mergeElements, fetchLog: mergeFetchLog, attachCalls: mergeAttachCalls } = await runScenario({
  currentSession: mergeableBranchSession,
  sessions: [mainSession, mergeableBranchSession],
  snapshot: {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [
      {
        sessionId: 'session-branch-merge',
        parentSessionId: 'session-main',
        lineRole: 'branch',
        status: 'active',
        goal: '表现主义',
        mainGoal: '学习电影史',
        checkpointSummary: '先把表现主义的关键特征讲清楚',
        nextStep: '先把表现主义的关键特征讲清楚',
      },
    ],
    taskClusters: [
      {
        mainSessionId: 'session-main',
        mainSession,
        currentBranchSessionId: 'session-branch-merge',
        branchSessionIds: ['session-branch-merge'],
        branchSessions: [
          {
            ...mergeableBranchSession,
            _branchDepth: 1,
            _branchParentSessionId: 'session-main',
            _branchStatus: 'active',
          },
        ],
      },
    ],
    skills: [],
    summaries: [],
  },
  fetchResponder: async (url, options, { snapshot }) => {
    if (options?.method === 'POST' && url === '/api/workbench/sessions/session-branch-merge/merge-return') {
      return {
        session: mainSession,
        snapshot,
      };
    }
    return snapshot;
  },
});

mergeElements.get('questTrackerCloseBtn').click();
await flushAsync();
assert.equal(
  mergeFetchLog.some((entry) => (
    entry.url === '/api/workbench/sessions/session-branch-merge/merge-return'
    && entry.options?.method === 'POST'
    && JSON.parse(entry.options?.body || '{}').mergeType === 'conclusion'
    && !Object.prototype.hasOwnProperty.call(JSON.parse(entry.options?.body || '{}'), 'broughtBack')
  )),
  true,
  'clicking branch finish should immediately merge back to the mainline and let the backend derive the carry-back summary',
);
assert.deepEqual(
  mergeAttachCalls.map((entry) => entry.id),
  ['session-main'],
  'successful branch merge should attach the returned mainline session into the workspace',
);

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

const mergedBranch = {
  id: 'session-branch-merged',
  name: 'Branch · 好莱坞黄金时代',
  sourceContext: { parentSessionId: 'session-main' },
  taskCard: {
    lineRole: 'branch',
    goal: '好莱坞黄金时代',
    mainGoal: '学习电影史',
    nextSteps: ['比较制片厂制度和作者表达'],
  },
};

mainSession.taskCard.candidateBranches = ['黑色电影'];
branchSession.taskCard.candidateBranches = ['卡里加里博士'];

const { elements: expandedElements } = await runScenario({
  currentSession: nestedBranch,
  sessions: [mainSession, branchSession, nestedBranch, parkedBranch, parkedBranchChild, mergedBranch],
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
        branchSessionIds: ['session-branch', 'session-branch-child', 'session-branch-parked', 'session-branch-parked-child', 'session-branch-merged'],
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
          {
            ...mergedBranch,
            _branchStatus: 'merged',
            _branchDepth: 1,
            _branchParentSessionId: 'session-main',
          },
        ],
      },
    ],
    skills: [],
    summaries: [],
  },
});

expandedElements.get('taskMapDrawerBtn').click();
const taskList = expandedElements.get('questTaskList');
assert.equal(taskList.hidden, false, 'clicking the task toggle should expand the tracker mind-map');
assert.equal(expandedElements.get('taskMapRail').hidden, false, 'mobile task map should appear once the user expands the map');
assert.equal(expandedElements.get('taskMapDrawerBackdrop').hidden, false, 'expanding the mobile task map should also show the drawer backdrop');
assert.equal(expandedElements.get('taskMapRail').classList.contains('is-mobile-open'), true, 'mobile task map should slide in as an open drawer');
const mobileBoard = findFirstByClass(taskList, 'quest-task-flow-shell');
assert.equal(Boolean(mobileBoard), true, 'expanded task bar should render the task map as a dedicated flow board');
const flowTitles = findAllByClass(mobileBoard, 'quest-task-flow-node-title').map((entry) => entry.textContent);
assert.equal(flowTitles.includes('表现主义'), true, 'the current path parent should stay visible in the quest map');
assert.equal(flowTitles.includes('德国表现主义电影'), true, 'deep current branch should render directly under its parent in the quest map');
assert.equal(flowTitles.includes('法国新浪潮'), true, 'non-current sibling branches should still stay visible in the quest map');
assert.equal(flowTitles.includes('好莱坞黄金时代'), true, 'merged sibling branches should still stay visible in the quest map');
assert.equal(flowTitles.includes('黑色电影'), true, 'root candidate branches should stay visible as optional side quests');
assert.equal(flowTitles.includes('卡里加里博士'), true, 'branch-local candidate suggestions should stay visible as nested side-quest nodes');
assert.equal(findAllByClass(mobileBoard, 'quest-task-flow-node-action').length, 2, 'candidate nodes should expose explicit branch-entry actions at every level');
const parkedFlowNode = findAllByClass(mobileBoard, 'quest-task-flow-node')
  .find((node) => findFirstByClass(node, 'quest-task-flow-node-title')?.textContent === '法国新浪潮');
assert.equal(Boolean(parkedFlowNode?.classList?.contains('is-parked')), true, 'parked branches should carry the parked node class for strikethrough styling');
const mergedFlowNode = findAllByClass(mobileBoard, 'quest-task-flow-node')
  .find((node) => findFirstByClass(node, 'quest-task-flow-node-title')?.textContent === '好莱坞黄金时代');
assert.equal(Boolean(mergedFlowNode?.classList?.contains('is-resolved')), true, 'merged branches should carry the terminal node class');
assert.equal(
  Boolean(findFirstByClass(mergedFlowNode, 'quest-task-flow-node-badge')?.classList?.contains('is-complete')),
  true,
  'merged branches should expose the completion badge hook for the finished icon',
);

const focusMainSession = {
  id: 'focus-main',
  name: '电影史路线规划',
  taskCard: {
    lineRole: 'main',
    summary: '先搭主线，再决定是否拆出独立支线',
    goal: '电影史路线规划',
    mainGoal: '电影史路线规划',
    nextSteps: ['先看当前主线和已开启支线'],
  },
};

const focusBranchSession = {
  id: 'focus-branch',
  name: 'Branch · 法国新浪潮',
  sourceContext: { parentSessionId: 'focus-main' },
  taskCard: {
    lineRole: 'branch',
    goal: '法国新浪潮',
    mainGoal: '电影史路线规划',
    nextSteps: ['补充跳切与作者论'],
  },
};

const focusNestedBranchSession = {
  id: 'focus-branch-child',
  name: 'Branch · 作者论',
  sourceContext: { parentSessionId: 'focus-branch' },
  taskCard: {
    lineRole: 'branch',
    goal: '作者论',
    mainGoal: '电影史路线规划',
    nextSteps: ['对比特吕弗和戈达尔'],
  },
};

const { elements: focusElements, workbench: focusWorkbench } = await runScenario({
  currentSession: focusMainSession,
  sessions: [focusMainSession, focusBranchSession, focusNestedBranchSession],
  snapshot: {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    taskClusters: [
      {
        mainSessionId: 'focus-main',
        mainSession: focusMainSession,
        mainGoal: '电影史路线规划',
        currentBranchSessionId: 'focus-branch',
        branchSessionIds: ['focus-branch', 'focus-branch-child'],
        branchSessions: [
          {
            ...focusBranchSession,
            _branchDepth: 1,
            _branchParentSessionId: 'focus-main',
            _branchStatus: 'active',
          },
          {
            ...focusNestedBranchSession,
            _branchDepth: 2,
            _branchParentSessionId: 'focus-branch',
            _branchStatus: 'active',
          },
        ],
      },
    ],
    skills: [],
    summaries: [],
  },
});

const titlesBeforeFocusSwitch = getFlowNodeTitles(focusElements.get('questTaskList'));
focusWorkbench.setFocusedSessionId('focus-branch-child');
await flushAsync();
assert.equal(
  focusWorkbench.getTaskMapProjection()?.activeNode?.sessionId,
  'focus-branch-child',
  'switching focus locally should update the projected active node immediately without waiting for a snapshot refresh',
);
assert.equal(
  focusElements.get('questTrackerTitle').textContent,
  '作者论',
  'current task bar should follow the locally focused branch immediately',
);
const currentFlowNode = findAllByClass(focusElements.get('questTaskList'), 'quest-task-flow-node')
  .find((node) => node.classList?.contains('is-current')) || null;
assert.equal(
  findFirstByClass(currentFlowNode, 'quest-task-flow-node-title')?.textContent || '',
  '作者论',
  'flow map highlight should follow the same focused branch as the task bar',
);
assert.deepEqual(
  getFlowNodeTitles(focusElements.get('questTaskList')),
  titlesBeforeFocusSwitch,
  'changing focus should not reshuffle the rendered flow node order',
);

const operationRecordSession = {
  id: 'operation-main',
  name: '电影史路线规划',
  taskCard: {
    lineRole: 'main',
    goal: '电影史路线规划',
    mainGoal: '电影史路线规划',
    nextSteps: ['先看主线再展开支线'],
  },
};

const operationBranchSession = {
  id: 'operation-branch',
  name: 'Branch · 法国新浪潮',
  sourceContext: { parentSessionId: 'operation-main' },
  taskCard: {
    lineRole: 'branch',
    goal: '法国新浪潮',
    mainGoal: '电影史路线规划',
    nextSteps: ['补充跳切与作者论'],
  },
};

const operationNestedBranchSession = {
  id: 'operation-branch-child',
  name: 'Branch · 作者论',
  sourceContext: { parentSessionId: 'operation-branch' },
  taskCard: {
    lineRole: 'branch',
    goal: '作者论',
    mainGoal: '电影史路线规划',
    nextSteps: ['对比特吕弗和戈达尔'],
  },
};

const {
  elements: operationRecordElements,
  fetchLog: operationRecordFetchLog,
  workbench: operationRecordWorkbench,
} = await runScenario({
  currentSession: operationNestedBranchSession,
  sessions: [operationRecordSession, operationBranchSession, operationNestedBranchSession],
  snapshot: {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    taskClusters: [
      {
        mainSessionId: 'operation-main',
        mainSession: operationRecordSession,
        mainGoal: '电影史路线规划',
        currentBranchSessionId: 'operation-branch-child',
        branchSessionIds: ['operation-branch', 'operation-branch-child'],
        branchSessions: [
          {
            ...operationBranchSession,
            _branchDepth: 1,
            _branchParentSessionId: 'operation-main',
            _branchStatus: 'active',
          },
          {
            ...operationNestedBranchSession,
            _branchDepth: 2,
            _branchParentSessionId: 'operation-branch',
            _branchStatus: 'active',
          },
        ],
      },
    ],
    skills: [],
    summaries: [],
  },
  fetchResponder: async (url, options, { snapshot }) => {
    if (url === '/api/workbench/sessions/operation-branch-child/operation-record') {
      return {
        sessionId: 'operation-main',
        currentSessionId: 'operation-branch-child',
        name: '电影史路线规划',
        items: [
          {
            type: 'commit',
            seq: 1,
            preview: '先搭电影史主线',
            timestamp: '2026-04-02T08:00:00.000Z',
            branches: [],
          },
          {
            type: 'branch',
            branchSessionId: 'operation-branch',
            name: 'Branch · 法国新浪潮',
            goal: '法国新浪潮',
            status: 'active',
            broughtBack: '补充跳切与作者论',
            commits: [
              {
                seq: 2,
                preview: '补充法国新浪潮',
                timestamp: '2026-04-02T08:05:00.000Z',
              },
            ],
            subBranches: [
              {
                branchSessionId: 'operation-branch-child',
                name: 'Branch · 作者论',
                goal: '作者论',
                status: 'active',
                broughtBack: '对比特吕弗和戈达尔',
                commits: [],
                subBranches: [],
              },
            ],
          },
        ],
      };
    }
    return snapshot;
  },
});

operationRecordWorkbench.openOperationRecord();
await flushAsync();
assert.equal(
  operationRecordFetchLog.some((entry) => entry.url === '/api/workbench/sessions/operation-branch-child/operation-record'),
  true,
  'opening the operation record should request the focused session record payload',
);
assert.equal(
  operationRecordElements.get('operationRecordBackdrop').hidden,
  false,
  'opening the operation record should show the clickable backdrop layer',
);
assert.equal(
  operationRecordElements.get('operationRecordRail').classList.contains('is-open'),
  true,
  'opening the operation record should slide the rail into view',
);
const operationRecordCards = findAllByClass(operationRecordElements.get('operationRecordInner'), 'operation-record-branch-card');
const nestedOperationCard = operationRecordCards.find((node) => (
  findFirstByClass(node, 'operation-record-branch-name')?.textContent === 'Branch · 作者论'
));
assert.equal(Boolean(nestedOperationCard), true, 'operation record should render nested branch cards');
assert.equal(
  nestedOperationCard?.classList?.contains('is-expanded'),
  true,
  'operation record should expand the current branch path by default',
);
assert.equal(
  findAllByClass(operationRecordElements.get('operationRecordInner'), 'operation-record-branch-summary')
    .some((node) => node.textContent === '对比特吕弗和戈达尔'),
  true,
  'operation record should show the current branch summary even before the branch has user messages',
);

console.log('test-chat-workbench-tracker: ok');
