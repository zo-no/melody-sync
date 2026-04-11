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

const controllerSource = readWorkbenchFrontendSource('controller.js');

function makeClassList(initial = [], onChange = () => {}) {
  const values = new Set(initial);
  const sync = () => onChange([...values].join(' '));
  return {
    add(...tokens) {
      tokens.filter(Boolean).forEach((token) => values.add(String(token)));
      sync();
    },
    remove(...tokens) {
      tokens.filter(Boolean).forEach((token) => values.delete(String(token)));
      sync();
    },
    contains(token) {
      return values.has(String(token));
    },
    toggle(token, force) {
      if (force === true) {
        values.add(String(token));
        sync();
        return true;
      }
      if (force === false) {
        values.delete(String(token));
        sync();
        return false;
      }
      if (values.has(String(token))) {
        values.delete(String(token));
        sync();
        return false;
      }
      values.add(String(token));
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
  const styleValues = new Map();
  const element = {
    tagName: String(tagName || 'div').toUpperCase(),
    id,
    hidden: false,
    textContent: '',
    title: '',
    dataset: {},
    children: [],
    parentNode: null,
    classList: null,
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    insertBefore(child, beforeChild) {
      const index = beforeChild ? this.children.indexOf(beforeChild) : -1;
      if (index < 0) return this.appendChild(child);
      child.parentNode = this;
      this.children.splice(index, 0, child);
      return child;
    },
    querySelector() {
      return null;
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      if (!listeners.has(type)) return;
      listeners.set(type, listeners.get(type).filter((entry) => entry !== handler));
    },
    setAttribute(name, value) {
      this[name] = String(value);
    },
    removeAttribute(name) {
      delete this[name];
    },
    focus() {},
    select() {},
    style: {
      setProperty(name, value) {
        styleValues.set(String(name), String(value));
      },
      getPropertyValue(name) {
        return styleValues.get(String(name)) || '';
      },
    },
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
      innerHTML = String(value || '');
      element.children = [];
    },
  });
  return element;
}

function buildHarness({ currentSession, sessions, recentTargetIds = [], taskMapGraph = null }) {
  const elementIds = [
    'questTracker',
    'questTrackerStatus',
    'questTrackerStatusDot',
    'questTrackerStatusText',
    'headerTitle',
    'headerTaskDetailBtn',
    'questTrackerTitle',
    'questTrackerBranch',
    'questTrackerBranchLabel',
    'questTrackerBranchTitle',
    'questTrackerNext',
    'questTrackerTime',
    'questTrackerPersistentSummary',
    'questTaskList',
    'taskMapRail',
    'sidebarOverlay',
    'taskMapResizeHandle',
    'taskCanvasPanel',
    'taskCanvasTitle',
    'taskCanvasSummary',
    'taskCanvasBody',
    'taskCanvasExpandBtn',
    'taskCanvasCloseBtn',
    'taskMapDrawerBtn',
    'taskMapDrawerBackdrop',
    'questTrackerFooter',
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
    'questTrackerCandidatesRow',
    'questTrackerCandidatesList',
    'emptyState',
  ];
  const elements = new Map(elementIds.map((id) => [id, makeElement('div', id)]));
  const captured = {
    rendererOptions: null,
    trackerRendererOptions: null,
  };

  const context = {
    console,
    sessions,
    window: {
      sessions,
      innerWidth: 1280,
      addEventListener() {},
      removeEventListener() {},
      setTimeout(callback) {
        callback();
        return 1;
      },
      clearTimeout() {},
      marked: {
        parse(value) {
          return `<p>${String(value || '').trim()}</p>`;
        },
      },
      requestIdleCallback(callback) {
        callback();
        return 1;
      },
      cancelIdleCallback() {},
      requestAnimationFrame(callback) {
        callback();
        return 1;
      },
      cancelAnimationFrame() {},
      MelodySyncSessionStateModel: {
        normalizeSessionWorkflowState(value) {
          const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
          if (normalized === 'waiting_user') return 'waiting_user';
          if (normalized === 'parked') return 'parked';
          if (normalized === 'done') return 'done';
          return '';
        },
      },
      MelodySyncQuestState: {
        createSelector() {
          return {
            deriveQuestState() {
              return { hasSession: false };
            },
            getClusterTitle() {
              return '';
            },
            getCurrentTaskSummary() {
              return '';
            },
          };
        },
      },
      MelodySyncTaskTrackerUi: {
        createTrackerRenderer(options = {}) {
          captured.trackerRendererOptions = options;
          return {
            renderStatus() {},
            getPrimaryTitle() { return '当前任务'; },
            getPrimaryDetail() { return ''; },
            getSecondaryDetail() { return ''; },
            renderDetail() {},
            renderHandoffActions() {},
            renderPersistentActions() {},
          };
        },
      },
      MelodySyncWorkbenchNodeCanvasUi: {
        createController() {
          return {
            renderNode() { return false; },
            clear() {},
            isOpen() { return false; },
            isExpanded() { return false; },
            hasCanvasView() { return false; },
          };
        },
      },
      MelodySyncTaskMapUi: {
        createRenderer(options = {}) {
          captured.rendererOptions = options;
          return {
            getRenderStateKey() {
              return 'reparent-targets-test';
            },
            renderFlowBoard() {
              return makeElement('div');
            },
          };
        },
      },
      MelodySyncTaskMapModel: {
        buildTaskMapProjection() {
          if (!taskMapGraph) return null;
          const nodes = Array.isArray(taskMapGraph?.nodes) ? taskMapGraph.nodes : [];
          const activeNode = nodes.find((node) => node?.isCurrent) || nodes[0] || null;
          return {
            mainQuests: [taskMapGraph],
            activeMainQuestId: String(taskMapGraph?.id || ''),
            activeNodeId: String(activeNode?.id || ''),
            activeMainQuest: taskMapGraph,
            activeNode,
          };
        },
      },
      MelodySyncBranchActions: {
        createController() {
          return {
            returnToMainline() {},
            parkAndReturnToMainline() {},
            reopenCurrentBranch() {},
            mergeCurrentBranchSummaryAndReturnToMainline() {},
            setCurrentBranchStatus() {},
          };
        },
      },
      MelodySyncOperationRecordUi: {
        createController() {
          return {
            openPersistentEditor() {},
            refreshIfOpen() {},
          };
        },
      },
      MelodySyncSessionTooling: {
        getCurrentRuntimeSelectionSnapshot() {
          return null;
        },
      },
      MelodySyncRuntime: {
        notify() {},
      },
    },
    document: {
      body: makeElement('body'),
      documentElement: makeElement('html'),
      getElementById(id) {
        return elements.get(id) || null;
      },
      addEventListener() {},
      removeEventListener() {},
      createElement(tagName = 'div') {
        return makeElement(tagName);
      },
      createElementNS(_namespace, tagName = 'div') {
        return makeElement(tagName);
      },
    },
    localStorage: {
      getItem(key) {
        if (key === 'melodysyncRecentReparentTargets') {
          return JSON.stringify(recentTargetIds);
        }
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    emptyState: elements.get('emptyState'),
    getCurrentSession() {
      return currentSession;
    },
    fetchJsonOrRedirect: async () => ({
      captureItems: [],
      projects: [],
      nodes: [],
      branchContexts: [],
      taskClusters: [],
      taskMapGraph,
      skills: [],
      summaries: [],
    }),
    fetch: async () => ({
      ok: true,
      async json() {
        return {
          captureItems: [],
          projects: [],
          nodes: [],
          branchContexts: [],
          taskClusters: [],
          taskMapGraph: null,
          skills: [],
          summaries: [],
        };
      },
    }),
    renderSessionList() {},
    attachSession() {},
    getComputedStyle() {
      return {
        getPropertyValue() {
          return '';
        },
      };
    },
  };

  context.window.window = context.window;
  context.window.document = context.document;
  context.window.fetch = context.fetch;
  context.window.localStorage = context.localStorage;
  context.window.getComputedStyle = context.getComputedStyle;
  context.globalThis = context;
  return { context, captured };
}

const sourceSession = {
  id: 'session-source',
  name: '输出路径梳理',
  workflowState: '',
  taskCard: {
    lineRole: 'main',
    goal: '梳理输出路径',
    mainGoal: '梳理输出路径',
    summary: '统一 payload 和 ETag 的输出路径',
    checkpoint: '先整理 payload 路径，再补 ETag 路由',
    knownConclusions: ['payload 和 ETag 这两条线要一起收口'],
  },
};

const relatedOpenTarget = {
  id: 'session-related-open',
  name: 'payload 输出路径',
  workflowState: '',
  taskCard: {
    lineRole: 'main',
    goal: '整理 payload 输出路径',
    mainGoal: '整理 payload 输出路径',
    summary: '把 payload 和 ETag 的输出路径统一起来',
    checkpoint: '优先收口输出路径',
  },
};

const recentUnrelatedTarget = {
  id: 'session-recent-unrelated',
  name: '周会节奏',
  workflowState: '',
  taskCard: {
    lineRole: 'main',
    goal: '安排周会节奏',
    mainGoal: '安排周会节奏',
    summary: '梳理周会节奏和同步机制',
  },
};

const relatedDoneTarget = {
  id: 'session-related-done',
  name: 'ETag 输出路径',
  workflowState: 'done',
  taskCard: {
    lineRole: 'main',
    goal: '清理 ETag 输出路径',
    mainGoal: '清理 ETag 输出路径',
    summary: '上一轮已经整理过 ETag 输出路径',
  },
};

const { context, captured } = buildHarness({
  currentSession: sourceSession,
  sessions: [
    sourceSession,
    relatedOpenTarget,
    recentUnrelatedTarget,
    relatedDoneTarget,
  ],
  recentTargetIds: [recentUnrelatedTarget.id],
});

await vm.runInNewContext(`(async () => { ${controllerSource}\nawait Promise.resolve(); })();`, context, {
  filename: 'frontend-src/workbench/controller.js',
});

const listReparentTargets = captured.rendererOptions?.listReparentTargets;
assert.equal(typeof listReparentTargets, 'function', 'controller should inject a reparent-target lister into the task-map renderer');
assert.equal(captured.rendererOptions?.listConnectTargets, undefined, 'controller should stop injecting connect-target listers into the task-map renderer');
const listHandoffTargets = captured.trackerRendererOptions?.listTaskHandoffTargets;
assert.equal(typeof listHandoffTargets, 'function', 'controller should inject a handoff-target lister into the task-card renderer');

const targets = listReparentTargets({ sourceSessionId: sourceSession.id }).filter((entry) => entry.mode === 'attach');
const handoffTargets = listHandoffTargets(sourceSession.id).filter((entry) => entry.mode === 'handoff');
assert.deepEqual(
  JSON.parse(JSON.stringify(targets.map((entry) => entry.sessionId))),
  [
    relatedOpenTarget.id,
    recentUnrelatedTarget.id,
    relatedDoneTarget.id,
  ],
  'reparent target ranking should prioritize related open tasks ahead of recent but unrelated or completed targets',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(handoffTargets.map((entry) => entry.sessionId))),
  [
    relatedOpenTarget.id,
    recentUnrelatedTarget.id,
    relatedDoneTarget.id,
  ],
  'handoff target ranking should prioritize related open tasks ahead of recent but unrelated or completed targets',
);
assert.equal(
  String(targets[0]?.displayPath || '').includes('相关内容'),
  true,
  'highly related reparent targets should be labeled as related content in the chooser',
);
assert.equal(
  String(targets[1]?.displayPath || '').includes('最近使用'),
  true,
  'recent but unrelated targets should still keep their recent-use label without overriding relevance-first ordering',
);
assert.equal(
  String(targets[2]?.displayPath || '').includes('已完成'),
  true,
  'completed targets should stay visible but surface their terminal status in the chooser',
);

const { context: connectedContext, captured: connectedCaptured } = buildHarness({
  currentSession: sourceSession,
  sessions: [
    sourceSession,
    relatedOpenTarget,
    recentUnrelatedTarget,
    relatedDoneTarget,
  ],
  recentTargetIds: [recentUnrelatedTarget.id],
  taskMapGraph: {
    id: 'quest:session-source',
    rootSessionId: sourceSession.id,
    title: sourceSession.name,
    nodes: [
      {
        id: `session:${sourceSession.id}`,
        kind: 'main',
        title: sourceSession.name,
        sessionId: sourceSession.id,
      },
      {
        id: `session:${relatedOpenTarget.id}`,
        kind: 'branch',
        title: relatedOpenTarget.name,
        sessionId: relatedOpenTarget.id,
      },
      {
        id: `session:${recentUnrelatedTarget.id}`,
        kind: 'branch',
        title: recentUnrelatedTarget.name,
        sessionId: recentUnrelatedTarget.id,
      },
    ],
    edges: [
      {
        id: `edge:related:${sourceSession.id}:${relatedOpenTarget.id}`,
        fromNodeId: `session:${sourceSession.id}`,
        toNodeId: `session:${relatedOpenTarget.id}`,
        type: 'related',
      },
    ],
  },
});

await vm.runInNewContext(`(async () => { ${controllerSource}\nawait Promise.resolve(); })();`, connectedContext, {
  filename: 'frontend-src/workbench/controller.js',
});

assert.equal(connectedCaptured.rendererOptions?.listConnectTargets, undefined, 'task-map renderer should keep graph-link target listers disconnected');
const connectedTargets = connectedCaptured.trackerRendererOptions?.listTaskHandoffTargets?.(sourceSession.id) || [];
assert.deepEqual(
  JSON.parse(JSON.stringify(connectedTargets.map((entry) => entry.sessionId))),
  [
    relatedOpenTarget.id,
    recentUnrelatedTarget.id,
    relatedDoneTarget.id,
  ],
  'task-card handoff targets should stay available even when tasks are already related on the graph',
);

console.log('test-workbench-controller-reparent-targets: ok');
