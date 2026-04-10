#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

function readWorkbenchFrontendSource(filename) {
  const candidates = [
    join(repoRoot, 'frontend-src', 'workbench', filename),
    join(repoRoot, 'static', 'frontend', 'workbench', filename),
  ];
  const targetPath = candidates.find((candidate) => existsSync(candidate));
  if (!targetPath) {
    throw new Error(`Workbench frontend source not found for ${filename}`);
  }
  return readFileSync(targetPath, 'utf8');
}

const nodeContractSource = readWorkbenchFrontendSource('node-contract.js');
const taskRunStatusSource = readWorkbenchFrontendSource('task-run-status.js');
const nodeEffectsSource = readWorkbenchFrontendSource('node-effects.js');
const nodeInstanceSource = readWorkbenchFrontendSource('node-instance.js');
const graphModelSource = readWorkbenchFrontendSource('graph-model.js');
const graphClientSource = readWorkbenchFrontendSource('graph-client.js');
const taskMapPlanSource = readWorkbenchFrontendSource('task-map-plan.js');
const taskMapClustersSource = readWorkbenchFrontendSource('task-map-clusters.js');
const taskMapMockPresetsSource = readWorkbenchFrontendSource('task-map-mock-presets.js');
const taskMapModelSource = readWorkbenchFrontendSource('task-map-model.js');
const questStateSource = readWorkbenchFrontendSource('quest-state.js');
const taskTrackerUiSource = readWorkbenchFrontendSource('task-tracker-ui.js');
const nodeRichViewUiSource = readWorkbenchFrontendSource('node-rich-view-ui.js');
const nodeCanvasUiSource = readWorkbenchFrontendSource('node-canvas-ui.js');
const taskMapReactBundleSource = readFileSync(join(repoRoot, 'public', 'app', 'task-map-react.bundle.js'), 'utf8');
const taskMapUiSource = readWorkbenchFrontendSource('task-map-ui.js');
const taskListUiSource = readWorkbenchFrontendSource('task-list-ui.js');
const statusCardUiSource = readWorkbenchFrontendSource('status-card-ui.js');
const persistentEditorUiSource = readWorkbenchFrontendSource('persistent-editor-ui.js');
const branchActionsSource = readWorkbenchFrontendSource('branch-actions.js');
const operationRecordUiSource = readWorkbenchFrontendSource('operation-record-ui.js');
const source = readWorkbenchFrontendSource('controller.js');

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

function makeElement(tagName = 'div', id = '') {
  let className = '';
  const listeners = new Map();
  const element = {
    tagName: String(tagName || 'div').toUpperCase(),
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
    insertBefore(child, beforeChild) {
      const index = beforeChild ? this.children.indexOf(beforeChild) : -1;
      if (index < 0) {
        this.children.push(child);
      } else {
        this.children.splice(index, 0, child);
      }
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
    focus() {},
    select() {},
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
  Object.defineProperty(element, 'firstChild', {
    get() {
      return this.children[0] || null;
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
    'headerTitle',
    'headerTaskDetailBtn',
    'persistentSessionBtn',
    'questTrackerTitle',
    'questTrackerBranch',
    'questTrackerBranchLabel',
    'questTrackerBranchTitle',
    'questTrackerNext',
    'questTrackerTime',
    'questTrackerPersistentSummary',
    'questTrackerFooter',
    'questTaskList',
    'taskMapRail',
    'taskCanvasPanel',
    'taskCanvasTitle',
    'taskCanvasSummary',
    'taskCanvasBody',
    'taskCanvasCloseBtn',
    'taskMapDrawerBtn',
    'taskMapDrawerBackdrop',
    'questTrackerActions',
    'questTrackerToggleBtn',
    'questTrackerCloseBtn',
    'questTrackerAltBtn',
    'questTrackerBackBtn',
    'questTrackerDetail',
    'questTrackerDetailToggle',
    'questTrackerGoalRow',
    'questTrackerGoalVal',
    'questTrackerConclusionsRow',
    'questTrackerConclusionsList',
    'questTrackerMemoryRow',
    'questTrackerMemoryList',
    'questTrackerMemoryCandidatesRow',
    'questTrackerMemoryCandidatesList',
    'questTrackerCandidatesRow',
    'questTrackerCandidatesList',
    'questFinishPanel',
    'questFinishResolveBtn',
    'questFinishParkBtn',
    'questFinishMergeBtn',
    'questFinishSummaryInput',
    'emptyState',
  ]) {
    elements.set(id, makeElement(id));
  }

  const fetchCalls = [];
  const fetchLog = [];
  const attachCalls = [];
  let renderSessionListCalls = 0;
  const context = {
    console,
    window: {
      sessions,
      innerWidth,
      addEventListener() {},
      marked: {
        parse(value) {
          return `<p>${String(value || '').trim()}</p>`;
        },
      },
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
      createElement(tagName = 'div') {
        return makeElement(tagName);
      },
      createElementNS(_namespace, tagName = 'div') {
        return makeElement(tagName);
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
    renderSessionList() {
      renderSessionListCalls += 1;
    },
    attachSession(id, session) {
      attachCalls.push({ id, session });
    },
  };
  context.window.fetch = context.fetch;
  context.globalThis = context;
  return {
    context,
    elements,
    fetchCalls,
    fetchLog,
    attachCalls,
    getRenderSessionListCalls: () => renderSessionListCalls,
  };
}

async function runScenario({ currentSession, sessions, snapshot, innerWidth = 0, fetchResponder = null }) {
  const {
    context,
    elements,
    fetchCalls,
    fetchLog,
    attachCalls,
    getRenderSessionListCalls,
  } = buildHarness({ currentSession, sessions, snapshot, innerWidth, fetchResponder });
  await vm.runInNewContext(`(async () => { ${nodeContractSource}\n${taskRunStatusSource}\n${nodeEffectsSource}\n${nodeInstanceSource}\n${graphModelSource}\n${graphClientSource}\n${taskMapPlanSource}\n${taskMapClustersSource}\n${taskMapMockPresetsSource}\n${taskMapModelSource}\n${questStateSource}\n${taskTrackerUiSource}\n${nodeRichViewUiSource}\n${nodeCanvasUiSource}\n${taskMapReactBundleSource}\n${taskMapUiSource}\n${taskListUiSource}\n${statusCardUiSource}\n${persistentEditorUiSource}\n${branchActionsSource}\n${operationRecordUiSource}\n${source}\nawait Promise.resolve(); })();`, context, {
    filename: 'frontend-src/workbench/controller.js',
  });
  await flushAsync(8);
  return {
    elements,
    fetchCalls,
    fetchLog,
    attachCalls,
    getRenderSessionListCalls,
    workbench: context.window.MelodySyncWorkbench,
  };
}

async function runReactScenario({ currentSession, sessions, snapshot, innerWidth = 0, fetchResponder = null }) {
  const { context, elements, fetchCalls, fetchLog, attachCalls } = buildHarness({ currentSession, sessions, snapshot, innerWidth, fetchResponder });
  context.MelodySyncTaskMapReactUi = context.window.MelodySyncTaskMapReactUi = {
    createRenderer({ documentRef, attachSession: attachSessionFn }) {
      const activeDocument = documentRef || context.document;
      return {
        rendererKind: 'react-flow',
        getRendererKind() {
          return 'react-flow';
        },
        getRenderStateKey() {
          return 'react-flow-test';
        },
        renderFlowBoard({ activeQuest }) {
          const shell = activeDocument.createElement('div');
          shell.className = 'quest-task-flow-shell react-flow-test-shell';
          shell.dataset.taskMapRenderer = 'react-flow';
          const nodes = Array.isArray(activeQuest?.nodes) ? activeQuest.nodes : [];
          for (const node of nodes) {
            const nodeEl = activeDocument.createElement('button');
            nodeEl.type = 'button';
            nodeEl.className = 'quest-task-flow-node';
            const titleEl = activeDocument.createElement('div');
            titleEl.className = 'quest-task-flow-node-title';
            titleEl.textContent = String(node?.title || '');
            nodeEl.appendChild(titleEl);
            if (node?.sessionId) {
              nodeEl.addEventListener('click', () => {
                attachSessionFn?.(node.sessionId, null);
              });
            }
            shell.appendChild(nodeEl);
          }
          return shell;
        },
      };
    },
  };
  await vm.runInNewContext(`(async () => { ${nodeContractSource}\n${taskRunStatusSource}\n${nodeEffectsSource}\n${nodeInstanceSource}\n${graphModelSource}\n${graphClientSource}\n${taskMapPlanSource}\n${taskMapClustersSource}\n${taskMapMockPresetsSource}\n${taskMapModelSource}\n${questStateSource}\n${taskTrackerUiSource}\n${nodeRichViewUiSource}\n${nodeCanvasUiSource}\n${taskMapUiSource}\n${taskListUiSource}\n${statusCardUiSource}\n${persistentEditorUiSource}\n${branchActionsSource}\n${operationRecordUiSource}\n${source}\nawait Promise.resolve(); })();`, context, {
    filename: 'frontend-src/workbench/controller.js',
  });
  await flushAsync(8);
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

function findAllByTagName(node, tagName, results = []) {
  if (!node) return results;
  if (String(node.tagName || '').toUpperCase() === String(tagName || '').toUpperCase()) {
    results.push(node);
  }
  for (const child of Array.isArray(node.children) ? node.children : []) {
    findAllByTagName(child, tagName, results);
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

const {
  elements: reactElements,
  attachCalls: reactAttachCalls,
  workbench: reactWorkbench,
} = await runReactScenario({
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
    ],
    skills: [],
    summaries: [],
  },
});

assert.equal(
  reactWorkbench.getTaskMapRendererKind(),
  'react-flow',
  'controller should report the React Flow renderer when the shared bundle path is available',
);
assert.equal(
  reactElements.get('questTaskList').children[0]?.dataset?.taskMapRenderer,
  'react-flow',
  'controller should mount the React-backed task map surface on the normal renderer path',
);
findAllByClass(reactElements.get('questTaskList'), 'quest-task-flow-node')
  .find((node) => findFirstByClass(node, 'quest-task-flow-node-title')?.textContent === '表现主义')
  ?.click();
assert.deepEqual(
  reactAttachCalls.map((entry) => entry.id),
  ['session-main-branch'],
  'React-backed task-map nodes should still switch the workspace to the selected branch session',
);

const {
  elements: mainElements,
  fetchCalls: mainFetchCalls,
  attachCalls: mainAttachCalls,
  workbench: mainWorkbench,
} = await runScenario({
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
assert.equal(mainWorkbench.getTaskMapRendererKind(), 'react-flow', 'controller should surface the active task-map renderer kind for diagnostics');
assert.equal(mainElements.get('questTrackerLabel').textContent, '', 'mainline tracker should not render an extra task-bar label');
assert.equal(mainElements.get('questTrackerStatus').hidden, true, 'idle mainline tasks should not render a redundant status badge inside the task bar');
assert.equal(mainElements.get('questTrackerStatusText').textContent, '', 'idle mainline tasks should not surface an explicit idle label');
assert.equal(mainElements.get('questTrackerTitle').hidden, false, 'mainline tracker should show the current task title directly');
assert.equal(mainElements.get('questTrackerTitle').textContent, '系统学习电影史', 'mainline tracker should show the main task title before any supporting detail');
assert.equal(mainElements.get('questTrackerBranch').hidden, false, 'mainline tracker should keep one supporting detail block directly under the title');
assert.equal(mainElements.get('questTrackerBranchTitle').textContent, '先搭电影史主线框架', 'mainline tracker should place the current task detail under the title');
assert.equal(mainElements.get('questTrackerNext').hidden, true, 'mainline tracker should avoid duplicating the same detail block');
assert.equal(mainElements.get('questTracker').classList.contains('is-task-complete'), false, 'in-progress tasks should not apply completed task-bar highlighting');
assert.equal(mainElements.get('taskMapRail').hidden, false, 'desktop task manager should keep the task map rail visible');
assert.equal(mainElements.get('questTaskList').hidden, false, 'desktop task manager should render the task map by default');
assert.equal(mainElements.get('questTaskList').classList.contains('is-flow-board'), true, 'task-map mounts should route scrolling through the dedicated flow-board surface');
assert.equal(Boolean(findFirstByClass(mainElements.get('questTaskList'), 'quest-task-flow-shell')), true, 'desktop task map should render as a dedicated flow board');
assert.deepEqual(mainFetchCalls, [
  '/api/workbench/sessions/session-main/tracker',
  '/api/workbench',
  '/api/workbench/sessions/session-main/task-map-graph',
  '/api/workbench/sessions/session-main/memory-candidates',
], 'tracker should fetch the lightweight session tracker snapshot before the full workbench snapshot');
findAllByClass(mainElements.get('questTaskList'), 'quest-task-flow-node')
  .find((node) => findFirstByClass(node, 'quest-task-flow-node-title')?.textContent === '表现主义')
  ?.click();
assert.deepEqual(
  mainAttachCalls.map((entry) => entry.id),
  ['session-main-branch'],
  'clicking an existing flow node should still switch the workspace to that branch session',
);

const runningPreviewSession = {
  id: 'session-live-preview',
  name: '修任务卡展示',
  taskCard: {
    lineRole: 'main',
    goal: '修任务卡展示',
    mainGoal: '修任务卡展示',
    summary: '',
    checkpoint: '',
    candidateBranches: [],
    knownConclusions: [],
    memory: [],
  },
  activity: {
    run: {
      state: 'running',
      phase: 'running',
      startedAt: '2026-04-10T01:30:00.000Z',
      runId: 'run-live-preview',
      cancelRequested: false,
    },
    queue: { state: 'idle', count: 0 },
    rename: { state: 'idle', error: null },
    compact: { state: 'idle' },
  },
};

const {
  elements: livePreviewElements,
  getRenderSessionListCalls: getLivePreviewRenderSessionListCalls,
  workbench: livePreviewWorkbench,
} = await runScenario({
  currentSession: runningPreviewSession,
  sessions: [runningPreviewSession],
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

assert.match(
  livePreviewElements.get('questTrackerBranchTitle').textContent,
  /当前任务正在执行中|进行中|运行中/,
  'running sessions without a concrete checkpoint should fall back to a generic execution summary before a live preview arrives',
);
assert.equal(
  livePreviewWorkbench.setLiveTaskCardPreview({
    summary: '修任务卡',
    checkpoint: '让运行中页面也读取最新 task_card 进度',
    knownConclusions: ['运行中的隐藏 task_card 不应再只停留在 transcript sidecar'],
  }, {
    sessionId: 'session-live-preview',
    sourceSeq: 42,
  }),
  true,
  'workbench should accept a live task-card preview patch for the currently running session',
);
assert.equal(
  getLivePreviewRenderSessionListCalls(),
  1,
  'live task-card preview updates should also rerender the session surface so sidebar items pick up the new checkpoint immediately',
);
assert.equal(
  livePreviewElements.get('questTrackerBranchTitle').textContent,
  '让运行中页面也读取最新 task_card 进度',
  'running task bars should immediately adopt the latest live task-card checkpoint instead of waiting for persisted session metadata',
);
livePreviewElements.get('questTrackerDetailToggle').click();
assert.equal(
  livePreviewElements.get('questTrackerConclusionsRow').hidden,
  false,
  'live task-card previews should also feed the expanded tracker detail rows',
);
assert.deepEqual(
  findAllByClass(livePreviewElements.get('questTrackerConclusionsList'), 'quest-tracker-detail-item').map((entry) => entry?.textContent),
  ['运行中的隐藏 task_card 不应再只停留在 transcript sidecar'],
  'tracker detail should render conclusions from the live task-card preview payload',
);

const sparseIdleMainSession = {
  id: 'session-main-idle-sparse',
  name: '初始化任务',
  taskCard: {
    lineRole: 'main',
    goal: '初始化任务',
    mainGoal: '初始化任务',
  },
};

const { elements: sparseIdleElements } = await runScenario({
  currentSession: sparseIdleMainSession,
  sessions: [sparseIdleMainSession],
  snapshot: {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    taskClusters: [
      {
        mainSessionId: 'session-main-idle-sparse',
        mainSession: sparseIdleMainSession,
        mainGoal: '初始化任务',
        currentBranchSessionId: '',
        branchSessionIds: [],
        branchSessions: [],
      },
    ],
    skills: [],
    summaries: [],
  },
});

assert.equal(
  sparseIdleElements.get('questTrackerBranch').hidden,
  true,
  'sparse mainline trackers should stay visually quiet when there is no meaningful progress detail yet',
);

const recurringSession = {
  id: 'session-main-recurring',
  name: '每日检查任务',
  persistent: {
    kind: 'recurring_task',
    state: 'active',
    recurring: {
      cadence: 'daily',
      timeOfDay: '09:15',
      timezone: 'Asia/Shanghai',
      nextRunAt: '2026-04-10T01:15:00.000Z',
      lastRunAt: '2026-04-09T01:15:00.000Z',
    },
    runtimePolicy: {
      schedule: {
        mode: 'session_default',
      },
    },
  },
  taskCard: {
    lineRole: 'main',
    goal: '每日检查任务',
    mainGoal: '每日检查任务',
    nextSteps: ['检查今天的执行结果'],
  },
};

const { elements: recurringElements } = await runScenario({
  currentSession: recurringSession,
  sessions: [recurringSession],
  snapshot: {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    taskClusters: [
      {
        mainSessionId: 'session-main-recurring',
        mainSession: recurringSession,
        mainGoal: '每日检查任务',
        currentBranchSessionId: '',
        branchSessionIds: [],
        branchSessions: [],
      },
    ],
    skills: [],
    summaries: [],
  },
});

assert.equal(
  recurringElements.get('persistentSessionBtn').hidden,
  false,
  'persistent sessions should expose a dedicated automation button in the header',
);
assert.equal(
  recurringElements.get('persistentSessionBtn').classList.contains('is-persistent-active'),
  true,
  'persistent header button should show an active state when the current session is already automated',
);
assert.equal(
  recurringElements.get('questTrackerPersistentSummary').hidden,
  false,
  'recurring sessions should render a persistent summary card in the tracker',
);
assert.equal(
  findAllByClass(recurringElements.get('questTrackerPersistentSummary'), 'quest-tracker-persistent-chip')
    .map((node) => node.textContent)
    .join(' | '),
  '自动执行中 | 每天 09:15 | 下次 04-10 09:15 | 上次 04-09 09:15 | 调度 会话默认',
  'persistent summary should expose cadence, next run, last run, and runtime policy',
);

const completedMainSession = {
  id: 'session-main-done',
  name: '系统学习电影史',
  workflowState: 'done',
  taskCard: {
    lineRole: 'main',
    summary: '梳理电影史脉络结构图谱',
    goal: '系统学习电影史',
    mainGoal: '系统学习电影史',
    nextSteps: ['先搭电影史主线框架'],
  },
};

const { elements: completedMainElements } = await runScenario({
  currentSession: completedMainSession,
  sessions: [completedMainSession],
  snapshot: {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    taskClusters: [
      {
        mainSessionId: 'session-main-done',
        mainSession: completedMainSession,
        mainGoal: '系统学习电影史',
        currentBranchSessionId: '',
        branchSessionIds: [],
        branchSessions: [],
      },
    ],
    skills: [],
    summaries: [],
  },
});

assert.equal(
  completedMainElements.get('questTracker').classList.contains('is-task-complete'),
  true,
  'done workflowState should highlight the task bar as completed',
);
assert.equal(
  completedMainElements.get('questTrackerStatusText').textContent,
  '已完成',
  'done workflowState should surface a completed status label in the task bar',
);

const { elements: completedMainMobileElements } = await runScenario({
  currentSession: completedMainSession,
  sessions: [completedMainSession],
  innerWidth: 390,
  snapshot: {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    taskClusters: [
      {
        mainSessionId: 'session-main-done',
        mainSession: completedMainSession,
        mainGoal: '系统学习电影史',
        currentBranchSessionId: '',
        branchSessionIds: [],
        branchSessions: [],
      },
    ],
    skills: [],
    summaries: [],
  },
});

assert.equal(
  completedMainMobileElements.get('headerTaskDetailBtn').classList.contains('is-task-complete'),
  true,
  'mobile task-bar disclosure should also carry completed highlighting for done tasks',
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
assert.equal(
  findAllByClass(candidateOnlyBoard, 'quest-task-flow-node-action')
    .some((entry) => entry?.textContent === '开启'),
  true,
  'candidate-only suggestion nodes should expose an explicit branch-entry action',
);
assert.equal(candidateOnlyElements.get('questTrackerTitle').textContent, '为用户搭出一条兼顾电影史主线与美术史兴趣维度的学习路线', 'mainline tracker should keep the fixed session task title as the top-level anchor');
assert.equal(candidateOnlyElements.get('questTrackerBranchTitle').textContent, '先明确主线骨架，再判断哪些方向值得拆成支线', 'mainline tracker should use the stable checkpoint as the task-progress detail when no next step exists yet');
assert.equal(candidateOnlyElements.get('questTrackerNext').textContent, '2 个建议', 'mainline tracker should surface candidate branch discovery as a compact secondary hint');
candidateOnlyElements.get('questTrackerDetailToggle').click();
assert.equal(candidateOnlyElements.get('questTrackerDetail').hidden, false, 'expanding the tracker detail should reveal the right-side task detail panel');
assert.equal(candidateOnlyElements.get('questTrackerCandidatesRow').hidden, false, 'candidate-only mainline tasks should expose branch dispatch actions in the tracker detail');
assert.deepEqual(
  findAllByClass(candidateOnlyElements.get('questTrackerCandidatesList'), 'quest-branch-suggestion-title').map((entry) => entry?.textContent),
  ['改成视觉风格线', '生成12周片单'],
  'tracker detail should list the visible candidate branches in order',
);

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

candidateOpenElements.get('questTrackerDetailToggle').click();
const trackerCandidateToOpen = findAllByClass(candidateOpenElements.get('questTrackerCandidatesList'), 'quest-branch-suggestion-item')
  .find((node) => findFirstByClass(node, 'quest-branch-suggestion-title')?.textContent === '改成视觉风格线');
findAllByTagName(trackerCandidateToOpen, 'button')[0]?.click();
await flushAsync();
assert.equal(
  candidateOpenFetchLog.some((entry) => (
    entry.url === '/api/workbench/sessions/session-main-candidate-only/branches'
    && entry.options?.method === 'POST'
    && JSON.parse(entry.options?.body || '{}').goal === '改成视觉风格线'
  )),
  true,
  'clicking a tracker-detail candidate suggestion should open a real branch through the existing branch-creation endpoint',
);
assert.deepEqual(
  candidateOpenAttachCalls.map((entry) => entry.id),
  ['session-main-candidate-branch'],
  'opening a tracker-detail candidate suggestion should attach the newly created branch session into the main workspace flow',
);

const memoryReviewSession = {
  id: 'session-memory-review',
  name: '沉淀操作习惯',
  taskCard: {
    lineRole: 'main',
    goal: '沉淀操作习惯',
    mainGoal: '沉淀操作习惯',
    checkpoint: '筛选值得留下的长期记忆',
  },
};

let memoryReviewCandidates = [
  {
    id: 'memcand-review-1',
    sessionId: 'session-memory-review',
    text: '用户偏好先看 diff 再决定是否合并',
    type: 'profile',
    target: 'agent-profile',
    confidence: 0.91,
    status: 'candidate',
  },
];

const {
  elements: memoryReviewElements,
  fetchLog: memoryReviewFetchLog,
} = await runScenario({
  currentSession: memoryReviewSession,
  sessions: [memoryReviewSession],
  snapshot: {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    taskClusters: [
      {
        mainSessionId: 'session-memory-review',
        mainSession: memoryReviewSession,
        mainGoal: '沉淀操作习惯',
        currentBranchSessionId: '',
        branchSessionIds: [],
        branchSessions: [],
      },
    ],
    skills: [],
    summaries: [],
  },
  fetchResponder: async (url, options, { snapshot }) => {
    if (url === '/api/workbench/sessions/session-memory-review/memory-candidates') {
      return {
        memoryCandidates: memoryReviewCandidates,
        snapshot,
      };
    }
    if (
      options?.method === 'POST'
      && url === '/api/workbench/sessions/session-memory-review/memory-candidates/memcand-review-1/status'
    ) {
      memoryReviewCandidates = [];
      return {
        memoryCandidate: {
          id: 'memcand-review-1',
          sessionId: 'session-memory-review',
          status: 'approved',
        },
        snapshot,
      };
    }
    return snapshot;
  },
});

memoryReviewElements.get('questTrackerDetailToggle').click();
await flushAsync();
assert.equal(
  memoryReviewElements.get('questTrackerMemoryCandidatesRow').hidden,
  false,
  'tracker detail should expose a dedicated row when unresolved memory candidates exist',
);
assert.deepEqual(
  findAllByClass(memoryReviewElements.get('questTrackerMemoryCandidatesList'), 'quest-memory-candidate-text')
    .map((entry) => entry?.textContent),
  ['用户偏好先看 diff 再决定是否合并'],
  'memory review row should show staged candidate text',
);
assert.deepEqual(
  findAllByClass(memoryReviewElements.get('questTrackerMemoryCandidatesList'), 'quest-memory-candidate-meta')
    .map((entry) => entry?.textContent),
  ['习惯 · agent-profile · 置信 91%'],
  'memory review row should surface the candidate type, target, and confidence',
);
findAllByClass(memoryReviewElements.get('questTrackerMemoryCandidatesList'), 'quest-branch-btn')
  .find((entry) => entry?.textContent === '采纳')
  ?.click();
await flushAsync(12);
assert.equal(
  memoryReviewFetchLog.some((entry) => (
    entry.url === '/api/workbench/sessions/session-memory-review/memory-candidates/memcand-review-1/status'
    && entry.options?.method === 'POST'
    && JSON.parse(entry.options?.body || '{}').status === 'approved'
  )),
  true,
  'reviewing a memory candidate should post the selected status to the new workbench endpoint',
);
assert.equal(
  memoryReviewElements.get('questTrackerMemoryCandidatesRow').hidden,
  true,
  'approved memory candidates should disappear from the unresolved tracker queue after refresh',
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
assert.equal(branchElements.get('headerTaskDetailBtn').hidden, false, 'mobile tracker should expose the task-detail disclosure in the header title slot');
assert.equal(branchElements.get('headerTaskDetailBtn').textContent, '表现主义 ▸', 'mobile tracker should use the current task title as the header task-detail disclosure');
assert.equal(branchElements.get('headerTitle').hidden, true, 'mobile tracker should stop rendering the project title while a task is attached');
assert.equal(branchElements.get('questTracker').hidden, true, 'mobile tracker should collapse the task detail panel by default');
assert.equal(branchElements.get('questTrackerTitle').hidden, false, 'branch tracker should keep the branch title visible');
assert.equal(branchElements.get('questTrackerTitle').textContent, '表现主义', 'branch tracker should show the current branch goal');
assert.equal(branchElements.get('questTrackerCloseBtn').textContent, '收束支线', 'branch tracker should expose a compact finish action');
assert.equal(branchElements.get('questTrackerCloseBtn').hidden, false, 'branch tracker should show the finish entry point');
assert.equal(branchElements.get('questTrackerAltBtn').textContent, '挂起', 'branch tracker should expose a compact park action');
assert.equal(branchElements.get('questTrackerAltBtn').hidden, false, 'branch tracker should show the stop action inline');
assert.equal(branchElements.get('questTrackerBackBtn').hidden, true, 'active branch tracker should keep the reopen action hidden');
assert.deepEqual(branchFetchCalls, [
  '/api/workbench/sessions/session-branch/tracker',
  '/api/workbench',
  '/api/workbench/sessions/session-main/task-map-graph',
  '/api/workbench/sessions/session-branch/memory-candidates',
], 'branch tracker should resolve the task-map graph back to the root main session after the lightweight tracker payload');
assert.equal(branchElements.get('questTrackerStatus').hidden, true, 'mobile branch tracker should avoid a redundant idle status badge inside the task bar');
assert.equal(branchElements.get('taskMapDrawerBtn').hidden, false, 'mobile branch tracker should expose the header task-map drawer toggle');
assert.equal(branchElements.get('questTrackerToggleBtn').hidden, true, 'mobile branch tracker should stop rendering the old inline task-map toggle');
assert.equal(branchElements.get('taskMapRail').hidden, false, 'mobile branch tracker should keep the task map drawer mounted off-canvas');
assert.equal(branchElements.get('taskMapDrawerBackdrop').hidden, true, 'mobile branch tracker should keep the drawer backdrop hidden while collapsed');
assert.equal(branchElements.get('taskMapRail').classList.contains('is-mobile-open'), false, 'mobile task map drawer should stay collapsed by default');
assert.equal(branchElements.get('questTaskList').hidden, false, 'branch state should keep the mind-map rendered inside the drawer even before interaction');
assert.equal(branchElements.get('questTracker').classList.contains('is-task-complete'), false, 'active branch tracker should not apply completed highlighting');
branchElements.get('headerTaskDetailBtn').click();
assert.equal(branchElements.get('headerTaskDetailBtn').textContent, '表现主义 ▾', 'expanding the mobile task detail should keep the current task title in the header disclosure');
assert.equal(branchElements.get('questTracker').hidden, false, 'expanding the mobile task detail should reveal the task detail panel');
assert.equal(branchElements.get('questTrackerBranch').hidden, false, 'expanding the mobile task detail should reveal the parent mainline reference');
assert.equal(branchElements.get('questTrackerBranchLabel').textContent, '主线任务', 'expanded mobile detail should keep the branch label semantics intact');
assert.equal(branchElements.get('questTrackerBranchTitle').textContent, '来自主线：学习电影史', 'expanded mobile detail should show the parent mainline summary');
assert.equal(branchElements.get('questTrackerNext').hidden, false, 'expanding the mobile task detail should reveal the concise next-step summary');

const resolvedBranchSession = {
  id: 'session-branch-resolved',
  name: 'Branch · 新现实主义',
  sourceContext: { parentSessionId: 'session-main' },
  taskCard: {
    lineRole: 'branch',
    goal: '新现实主义',
    mainGoal: '学习电影史',
    nextSteps: ['对比《罗马，不设防的城市》与《偷自行车的人》'],
  },
};

const { elements: resolvedBranchElements } = await runScenario({
  currentSession: resolvedBranchSession,
  sessions: [mainSession, resolvedBranchSession],
  snapshot: {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [
      {
        sessionId: 'session-branch-resolved',
        parentSessionId: 'session-main',
        lineRole: 'branch',
        status: 'resolved',
        goal: '新现实主义',
        mainGoal: '学习电影史',
        nextStep: '对比《罗马，不设防的城市》与《偷自行车的人》',
      },
    ],
    taskClusters: [
      {
        mainSessionId: 'session-main',
        mainSession,
        currentBranchSessionId: 'session-branch-resolved',
        branchSessionIds: ['session-branch-resolved'],
        branchSessions: [
          {
            ...resolvedBranchSession,
            _branchStatus: 'resolved',
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

assert.equal(
  resolvedBranchElements.get('questTracker').classList.contains('is-task-complete'),
  true,
  'resolved branches should apply completed task-bar highlighting',
);

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
assert.equal(
  findAllByClass(mobileBoard, 'quest-task-flow-node-action')
    .filter((entry) => entry?.textContent === '开启').length,
  2,
  'candidate nodes should expose explicit branch-entry actions at every level',
);
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

const richCanvasSession = {
  id: 'session-rich-canvas',
  name: '右侧画布类型实验',
  taskCard: {
    lineRole: 'main',
    goal: '右侧画布类型实验',
    mainGoal: '右侧画布类型实验',
    nextSteps: ['先验证 markdown/html/iframe 三种右侧展示'],
  },
};

const { elements: richCanvasElements } = await runScenario({
  currentSession: richCanvasSession,
  sessions: [richCanvasSession],
  snapshot: {
    captureItems: [],
    projects: [],
    nodes: [],
    branchContexts: [],
    taskClusters: [
      {
        mainSessionId: 'session-rich-canvas',
        mainSession: richCanvasSession,
        mainGoal: richCanvasSession.taskCard.mainGoal,
        currentBranchSessionId: '',
        branchSessionIds: [],
        branchSessions: [],
      },
    ],
    taskMapPlans: [
      {
        rootSessionId: 'session-rich-canvas',
        mode: 'replace-default',
        title: '右侧画布类型实验',
        nodes: [
          {
            id: 'session:session-rich-canvas',
            kind: 'main',
            title: '任务总览',
            sourceSessionId: 'session-rich-canvas',
            parentNodeId: null,
            status: 'active',
            lineRole: 'main',
          },
          {
            id: 'plan:markdown',
            kind: 'candidate',
            title: 'Markdown 视图',
            sourceSessionId: 'session-rich-canvas',
            parentNodeId: 'session:session-rich-canvas',
            status: 'candidate',
            lineRole: 'candidate',
            view: {
              type: 'markdown',
              content: '## Markdown 内容',
              width: 420,
              height: 280,
            },
          },
          {
            id: 'plan:html',
            kind: 'done',
            title: 'HTML 视图',
            sourceSessionId: 'session-rich-canvas',
            parentNodeId: 'session:session-rich-canvas',
            status: 'done',
            lineRole: 'main',
            view: {
              type: 'html',
              renderMode: 'inline',
              content: '<strong>HTML 内容</strong>',
              width: 420,
              height: 280,
            },
          },
          {
            id: 'plan:iframe',
            kind: 'done',
            title: 'Iframe 视图',
            sourceSessionId: 'session-rich-canvas',
            parentNodeId: 'session:session-rich-canvas',
            status: 'done',
            lineRole: 'main',
            view: {
              type: 'iframe',
              src: 'https://example.com/embed',
              width: 420,
              height: 300,
            },
          },
        ],
      },
    ],
    skills: [],
    summaries: [],
  },
});

const richBoard = findFirstByClass(richCanvasElements.get('questTaskList'), 'quest-task-flow-shell');
assert.equal(Boolean(richBoard), true, 'rich canvas quests should still render inside the same flow board surface');
assert.equal(findAllByClass(richBoard, 'quest-task-flow-node-rich-body').length, 0, 'rich view content should no longer render inline inside the flow node surface');
assert.equal(richCanvasElements.get('taskCanvasPanel').hidden, false, 'rich canvas quests should open the dedicated node canvas rail');
assert.equal(richCanvasElements.get('taskMapRail').classList.contains('has-node-canvas'), true, 'task map rail should expose node canvas layout when a rich view node is selected');
assert.equal(findAllByClass(richCanvasElements.get('taskCanvasBody'), 'quest-task-flow-node-rich-markdown').length >= 1, true, 'node canvas should render markdown nodes via the declared node view type');
assert.match(richCanvasElements.get('taskCanvasTitle').textContent, /Markdown 视图/);
assert.match(findFirstByClass(richCanvasElements.get('taskCanvasBody'), 'quest-task-flow-node-rich-body')?.innerHTML || '', /Markdown 内容/);
richCanvasElements.get('taskCanvasCloseBtn').click();
assert.equal(richCanvasElements.get('taskCanvasPanel').hidden, true, 'closing the node canvas should keep the rail closed until the user explicitly reopens a rich-view node');
assert.equal(richCanvasElements.get('taskMapRail').classList.contains('has-node-canvas'), false, 'closing the node canvas should also clear the dedicated node-canvas rail state');
findAllByClass(richBoard, 'quest-task-flow-node')
  .find((node) => findFirstByClass(node, 'quest-task-flow-node-title')?.textContent === 'HTML 视图')
  ?.click();
assert.equal(richCanvasElements.get('taskCanvasPanel').hidden, false, 'explicitly selecting another rich-view node should reopen the node canvas rail');
assert.equal(findAllByClass(richCanvasElements.get('taskCanvasBody'), 'quest-task-flow-node-rich-html').length >= 1, true, 'clicking a rich-view node should swap the node canvas to the selected html view');
assert.match(
  findAllByClass(richCanvasElements.get('taskCanvasBody'), 'quest-task-flow-node-rich-body')
    .map((node) => node.innerHTML || '')
    .find((html) => /HTML 内容/.test(html)) || '',
  /HTML 内容/,
);
findAllByClass(richBoard, 'quest-task-flow-node')
  .find((node) => findFirstByClass(node, 'quest-task-flow-node-title')?.textContent === 'Iframe 视图')
  ?.click();
assert.equal(findAllByTagName(richCanvasElements.get('taskCanvasBody'), 'IFRAME').length, 1, 'iframe node views should render a real iframe surface inside the node canvas rail');

console.log('test-chat-workbench-tracker: ok');
