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
      if (index < 0) {
        return this.appendChild(child);
      }
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
  Object.defineProperty(element, 'firstChild', {
    get() {
      return element.children[0] || null;
    },
  });
  return element;
}

function buildHarness({ currentSession, sessions }) {
  const elementIds = [
    'questTracker',
    'questTrackerStatus',
    'questTrackerStatusDot',
    'questTrackerStatusText',
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
        createTrackerRenderer() {
          return {
            renderStatus() {},
            getPrimaryTitle() { return '当前任务'; },
            getPrimaryDetail() { return ''; },
            getSecondaryDetail() { return ''; },
            renderDetail() {},
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
              return 'task-handoff-preview-test';
            },
            renderFlowBoard() {
              return makeElement('div');
            },
          };
        },
      },
      MelodySyncTaskMapModel: {
        buildTaskMapProjection() {
          return null;
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
    },
    document: {
      body: makeElement('body'),
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
      getItem() { return null; },
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
      taskMapGraph: null,
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
  };

  context.window.window = context.window;
  context.window.document = context.document;
  context.window.fetch = context.fetch;
  context.globalThis = context;
  return { context, captured };
}

const sourceSession = {
  id: 'session-source',
  name: '整理运行数据',
  taskCard: {
    lineRole: 'main',
    goal: '整理运行数据',
    mainGoal: '整理运行数据',
    checkpoint: '优先梳理运行期发现的约束和结论',
    background: ['最新回归里已经收集到多条运行日志'],
    rawMaterials: ['日志显示 edge 按钮还没有落到连线上'],
    assumptions: ['目标任务暂时不要直接改 goal'],
    knownConclusions: ['需要先实现 A 到 B 的结构化交接'],
    nextSteps: ['把 handoff 入口做到 edge 上'],
  },
};

const targetSession = {
  id: 'session-target',
  name: '把 handoff 入口接到任务边上',
  taskCard: {
    lineRole: 'main',
    goal: '把 handoff 入口接到任务边上',
    mainGoal: '把 handoff 入口接到任务边上',
    checkpoint: '先把边上的 handoff 交互做顺',
    nextSteps: ['让任务边上的传递交互更顺手'],
    knownConclusions: ['目标任务需要聚焦 handoff 入口'],
  },
};

const { context, captured } = buildHarness({
  currentSession: sourceSession,
  sessions: [sourceSession, targetSession],
});

await vm.runInNewContext(`(async () => { ${controllerSource}\nawait Promise.resolve(); })();`, context, {
  filename: 'frontend-src/workbench/controller.js',
});

const previewBuilder = captured.rendererOptions?.buildTaskHandoffPreview;
assert.equal(typeof previewBuilder, 'function', 'controller should inject a handoff preview builder into the task-map renderer');

const preview = previewBuilder(sourceSession.id, targetSession.id, {});
assert.equal(preview?.sourceSessionId, sourceSession.id, 'preview should keep the source session id');
assert.equal(preview?.targetSessionId, targetSession.id, 'preview should keep the target session id');
assert.equal(
  Array.isArray(preview?.sections) && preview.sections.some((section) => section.label === '焦点'),
  true,
  'preview should expose a focus section for richer task-to-task handoff context',
);
assert.equal(
  Array.isArray(preview?.sections) && preview.sections.some((section) => section.label === '接入建议'),
  true,
  'preview should expose integration guidance instead of only showing a flat summary',
);

const focusSection = preview.sections.find((section) => section.label === '焦点') || { items: [] };
assert.equal(
  focusSection.items.some((entry) => entry.includes('源任务目标')),
  true,
  'preview focus should describe the source task focus',
);
assert.equal(
  focusSection.items.some((entry) => entry.includes('目标任务目标')),
  true,
  'preview focus should describe the target task focus',
);

const integrationSection = preview.sections.find((section) => section.label === '接入建议') || { items: [] };
assert.equal(
  integrationSection.items.some((entry) => entry.includes('handoff') || entry.includes('优先吸收')),
  true,
  'preview integration guidance should be target-aware',
);

console.log('test-workbench-controller-task-handoff-preview: ok');
