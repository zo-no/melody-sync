#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const nodeContractSource = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench', 'node-contract.js'),
  'utf8',
);
const taskRunStatusSource = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench', 'task-run-status.js'),
  'utf8',
);
const nodeEffectsSource = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench', 'node-effects.js'),
  'utf8',
);
const taskMapUiSource = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench', 'task-map-ui.js'),
  'utf8',
);

function makeClassList(owner) {
  const tokens = new Set();
  const sync = () => {
    owner._className = Array.from(tokens).join(' ');
  };
  return {
    add(...values) {
      values.filter(Boolean).forEach((value) => tokens.add(String(value)));
      sync();
    },
    remove(...values) {
      values.filter(Boolean).forEach((value) => tokens.delete(String(value)));
      sync();
    },
    contains(value) {
      return tokens.has(String(value));
    },
    setFromClassName(value) {
      tokens.clear();
      String(value || '').split(/\s+/).filter(Boolean).forEach((token) => tokens.add(token));
      sync();
    },
  };
}

function makeStyle() {
  const values = new Map();
  return {
    setProperty(name, value) {
      values.set(String(name), String(value));
    },
    getPropertyValue(name) {
      return values.get(String(name)) || '';
    },
  };
}

function makeElement(tagName = 'div') {
  const element = {
    tagName: String(tagName || 'div').toUpperCase(),
    children: [],
    dataset: {},
    hidden: false,
    textContent: '',
    innerHTML: '',
    title: '',
    scrollLeft: 0,
    scrollTop: 0,
    clientWidth: 0,
    clientHeight: 0,
    offsetWidth: 0,
    offsetHeight: 0,
    style: makeStyle(),
    _className: '',
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute(name, value) {
      if (String(name) === 'class') {
        this.className = String(value);
        return;
      }
      this[name] = String(value);
    },
    remove() {},
    closest() { return null; },
  };
  element.classList = makeClassList(element);
  Object.defineProperty(element, 'className', {
    get() {
      return element._className;
    },
    set(value) {
      element.classList.setFromClassName(value);
    },
  });
  if (element.tagName === 'BUTTON') {
    element.type = '';
  }
  return element;
}

function findFirstByClass(root, className) {
  if (!root) return null;
  if (root.classList?.contains?.(className)) return root;
  for (const child of Array.isArray(root.children) ? root.children : []) {
    const match = findFirstByClass(child, className);
    if (match) return match;
  }
  return null;
}

function findFlowNodeByTitle(root, title) {
  if (!root) return null;
  if (root.classList?.contains?.('quest-task-flow-node')) {
    const titleEl = findFirstByClass(root, 'quest-task-flow-node-title');
    if (titleEl?.textContent === title) {
      return root;
    }
  }
  for (const child of Array.isArray(root.children) ? root.children : []) {
    const match = findFlowNodeByTitle(child, title);
    if (match) return match;
  }
  return null;
}

const documentRef = {
  createElement(tagName) {
    return makeElement(tagName);
  },
  createElementNS(_ns, tagName) {
    return makeElement(tagName);
  },
  addEventListener() {},
};

const windowRef = {
  setTimeout(callback) {
    callback();
    return 0;
  },
  clearTimeout() {},
};

const context = {
  console,
  document: documentRef,
  window: windowRef,
};
context.globalThis = context;
context.window.window = context.window;
context.window.document = context.document;

vm.runInNewContext(nodeContractSource, context, { filename: 'workbench/node-contract.js' });
vm.runInNewContext(taskRunStatusSource, context, { filename: 'workbench/task-run-status.js' });
vm.runInNewContext(nodeEffectsSource, context, { filename: 'workbench/node-effects.js' });
vm.runInNewContext(taskMapUiSource, context, { filename: 'workbench/task-map-ui.js' });

const renderer = context.window.MelodySyncTaskMapUi.createRenderer({
  documentRef,
  windowRef,
  clipText(value) {
    return String(value || '').trim();
  },
});

const rootNode = {
  id: 'session:main-1',
  kind: 'main',
  title: '主任务',
  summary: '任务地图状态色应该和左栏一致',
  childNodeIds: ['session:branch-running', 'session:branch-waiting', 'session:branch-done'],
  isCurrentPath: true,
};

const runningNode = {
  id: 'session:branch-running',
  kind: 'branch',
  parentNodeId: 'session:main-1',
  sessionId: 'branch-running',
  title: '运行节点',
  status: 'active',
  activityState: 'running',
};

const waitingNode = {
  id: 'session:branch-waiting',
  kind: 'branch',
  parentNodeId: 'session:main-1',
  sessionId: 'branch-waiting',
  title: '等待节点',
  status: 'active',
  workflowState: 'waiting_user',
};

const completedNode = {
  id: 'session:branch-done',
  kind: 'branch',
  parentNodeId: 'session:main-1',
  sessionId: 'branch-done',
  title: '完成节点',
  status: 'active',
  workflowState: 'done',
  isCurrent: true,
  isCurrentPath: true,
};

const idleNode = {
  id: 'session:branch-idle',
  kind: 'branch',
  parentNodeId: 'session:main-1',
  sessionId: 'branch-idle',
  title: '空闲节点',
  status: 'active',
};

rootNode.childNodeIds.push(idleNode.id);

const nodeMap = new Map([
  [rootNode.id, rootNode],
  [runningNode.id, runningNode],
  [waitingNode.id, waitingNode],
  [completedNode.id, completedNode],
  [idleNode.id, idleNode],
]);

const board = renderer.renderFlowBoard({
  activeQuest: {
    id: 'quest:main-1',
    edges: [
      { fromNodeId: rootNode.id, toNodeId: runningNode.id, type: 'structural' },
      { fromNodeId: rootNode.id, toNodeId: waitingNode.id, type: 'structural' },
      { fromNodeId: rootNode.id, toNodeId: completedNode.id, type: 'structural' },
      { fromNodeId: rootNode.id, toNodeId: idleNode.id, type: 'structural' },
    ],
  },
  nodeMap,
  rootNode,
  state: {},
});

const runningFlowNode = findFlowNodeByTitle(board, '运行节点');
const waitingFlowNode = findFlowNodeByTitle(board, '等待节点');
const completedFlowNode = findFlowNodeByTitle(board, '完成节点');
const idleFlowNode = findFlowNodeByTitle(board, '空闲节点');

assert.ok(runningFlowNode, 'running flow node should render');
assert.ok(waitingFlowNode, 'waiting flow node should render');
assert.ok(completedFlowNode, 'completed flow node should render');
assert.ok(idleFlowNode, 'idle flow node should render');

assert.equal(runningFlowNode.classList.contains('is-status-running'), true);
assert.equal(waitingFlowNode.classList.contains('is-status-waiting-user'), true);
assert.equal(completedFlowNode.classList.contains('is-status-completed'), true);
assert.equal(completedFlowNode.classList.contains('is-resolved'), true);
assert.equal(idleFlowNode.classList.contains('is-status-idle'), true);
assert.equal(completedFlowNode.classList.contains('is-current'), true);
assert.equal(
  findFirstByClass(completedFlowNode, 'quest-task-flow-node-badge')?.classList?.contains('is-status-completed'),
  true,
  'badge styling should inherit the normalized completed-status class',
);
assert.equal(
  findFirstByClass(idleFlowNode, 'quest-task-flow-node-badge')?.textContent,
  '空闲',
  'non-current flow nodes should keep rendering a stable idle status badge',
);

console.log('test-workbench-task-map-ui: ok');
