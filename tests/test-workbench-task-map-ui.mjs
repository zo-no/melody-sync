#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

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
const taskMapUiSource = readWorkbenchFrontendSource('task-map-ui.js');
const taskMapReactBundleSource = readFileSync(join(repoRoot, 'public', 'app', 'task-map-react.bundle.js'), 'utf8');
const taskMapReactSource = readFileSync(
  join(repoRoot, 'frontend-src', 'workbench', 'task-map-react-ui.jsx'),
  'utf8',
);
const chatWorkbenchCssSource = readFileSync(
  join(repoRoot, 'frontend-src', 'chat-workbench.css'),
  'utf8',
);

assert.match(
  taskMapReactSource,
  /应用建议/,
  'task-map React UI should expose a compact apply-suggestion action from node context',
);
assert.match(
  taskMapReactSource,
  /activeActionNodeId/,
  'task-map React UI should gate node action strips behind explicit node activation instead of always showing them',
);
assert.match(
  taskMapReactSource,
  /isVisible=\{\s*actionStripActive[\s\S]*?\|\|\s*manualComposerOpen[\s\S]*?\|\|\s*reparentComposerOpen\s*\}/s,
  'task-map React UI should only show node action strips after explicit activation or while a composer is open',
);
assert.match(
  taskMapReactSource,
  /整理建议/,
  'task-map React UI should expose a restrained global suggestions entry for pending graph proposals',
);
assert.match(
  taskMapReactSource,
  /minZoom:\s*isMobile \? 0\.25 : 0\.42/,
  'mobile task-map fit should allow a much wider zoom-out range so dense graphs still fit on narrow screens',
);
assert.match(
  chatWorkbenchCssSource,
  /\.quest-task-flow-edge-handoff-popover[\s\S]*var\(--bg-elevated, var\(--bg-secondary, var\(--bg\)\)\)/s,
  'edge handoff popovers should derive their surface from theme tokens so dark mode keeps the copy readable',
);
assert.doesNotMatch(
  taskMapReactSource,
  /后续任务流程会显示在这里/,
  'task-map React UI should not hard-code a root-only empty-hint prompt',
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
  const listeners = new Map();
  const element = {
    tagName: String(tagName || 'div').toUpperCase(),
    children: [],
    parentNode: null,
    dataset: {},
    hidden: false,
    textContent: '',
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
      child.parentNode = this;
      this.children.push(child);
      return child;
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
      if (String(name) === 'class') {
        this.className = String(value);
        return;
      }
      this[name] = String(value);
    },
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    },
    closest() { return null; },
    focus() {},
    select() {},
    dispatchEvent(event = {}) {
      const type = String(event.type || '');
      const results = [];
      for (const handler of listeners.get(type) || []) {
        results.push(handler({
          preventDefault() {},
          stopPropagation() {},
          ...event,
        }));
      }
      return Promise.all(results);
    },
  };
  Object.defineProperty(element, 'innerHTML', {
    get() {
      return '';
    },
    set(_value) {
      element.children = [];
    },
  });
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

function findFirst(root, predicate) {
  if (!root) return null;
  if (predicate(root)) return root;
  for (const child of Array.isArray(root.children) ? root.children : []) {
    const match = findFirst(child, predicate);
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
  requestAnimationFrame(callback) {
    callback();
    return 0;
  },
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
vm.runInNewContext(taskMapReactBundleSource, context, { filename: 'workbench/task-map-react.bundle.js' });
vm.runInNewContext(taskMapUiSource, context, { filename: 'workbench/task-map-ui.js' });

const handoffCalls = [];
const renderer = context.window.MelodySyncTaskMapUi.createRenderer({
  documentRef,
  windowRef,
  clipText(value) {
    return String(value || '').trim();
  },
  listReparentTargets() {
    return [
      {
        mode: 'attach',
        sessionId: 'main-2',
        title: '目标任务',
        path: '目标任务 / 方案讨论',
        displayPath: '最近使用 · 目标任务 / 方案讨论',
        searchText: '目标任务 方案讨论',
      },
    ];
  },
  buildTaskHandoffPreview(sourceSessionId, targetSessionId) {
    return {
      sourceSessionId,
      targetSessionId,
      sourceTitle: sourceSessionId === 'main-1' ? '主任务' : '其他任务',
      targetTitle: targetSessionId === 'branch-running' ? '运行节点' : '其他节点',
      sections: [
        { key: 'conclusions', label: '结论', items: ['已经整理出需要传递的阶段信息'] },
        { key: 'nextSteps', label: '下一步', items: ['继续推进目标任务'] },
      ],
    };
  },
  async handoffSessionTaskData(sourceSessionId, payload = {}) {
    handoffCalls.push({
      sourceSessionId,
      targetSessionId: payload?.targetSessionId || '',
    });
    return { ok: true };
  },
});

assert.equal(renderer.rendererKind, 'react-flow', 'adapter should report the shared React renderer in isolated tests');
assert.equal(renderer.getRendererKind(), 'react-flow', 'renderer kind helper should stay consistent with the adapter metadata');

context.window.MelodySyncTaskMapReactUi = {
  createRenderer() {
    return {
      getRenderStateKey() {
        return 'react-flow';
      },
      renderFlowBoard() {
        const marker = makeElement('div');
        marker.className = 'react-flow-marker';
        return marker;
      },
    };
  },
};

const reactRenderer = context.window.MelodySyncTaskMapUi.createRenderer({
  documentRef,
  windowRef,
});
assert.equal(reactRenderer.rendererKind, 'react-flow', 'adapter should prefer the shared React Flow renderer when it is available');
assert.equal(reactRenderer.getRendererKind(), 'react-flow', 'react renderer metadata should stay queryable for diagnostics');
assert.doesNotMatch(
  taskMapReactSource,
  /const edgeInset = \d+/,
  'react task-map edges should not add a synthetic inset that leaves a gap from the node handle',
);
assert.match(
  taskMapReactSource,
  /style:\s*\{\s*width:\s*`\$\{Math\.ceil\(entry\.nodeWidth\)\}px`,\s*height:\s*`\$\{Math\.ceil\(entry\.nodeHeight\)\}px`,\s*minHeight:\s*`\$\{Math\.ceil\(entry\.nodeHeight\)\}px`,\s*\}/s,
  'react task-map nodes should render at the same fixed height used by the layout engine so edges connect to the visible card edge',
);
assert.match(
  taskMapReactSource,
  /getBezierPath\(\{\s*sourceX,\s*sourceY,\s*sourcePosition,\s*targetX,\s*targetY,\s*targetPosition,\s*curvature: 0\.32,\s*\}\)/s,
  'react task-map edges should use the raw handle coordinates so the line stays flush with the node',
);
assert.match(
  taskMapReactSource,
  /type="target"[\s\S]*?minWidth: 0,[\s\S]*?minHeight: 0,[\s\S]*?width: 0,[\s\S]*?height: 0/s,
  'react task-map target handles should collapse to a zero-size anchor so the edge does not float above the node',
);
assert.match(
  taskMapReactSource,
  /type="source"[\s\S]*?minWidth: 0,[\s\S]*?minHeight: 0,[\s\S]*?width: 0,[\s\S]*?height: 0/s,
  'react task-map source handles should collapse to a zero-size anchor so the edge does not float below the node',
);

const rootNode = {
  id: 'session:main-1',
  kind: 'main',
  sessionId: 'main-1',
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

const editableNode = {
  id: 'session:branch-editable',
  kind: 'branch',
  parentNodeId: 'session:main-1',
  sessionId: 'branch-editable',
  title: '可改挂节点',
  status: 'active',
  isCurrent: true,
  isCurrentPath: true,
};

rootNode.childNodeIds.push(idleNode.id, editableNode.id);

const nodeMap = new Map([
  [rootNode.id, rootNode],
  [runningNode.id, runningNode],
  [waitingNode.id, waitingNode],
  [completedNode.id, completedNode],
  [idleNode.id, idleNode],
  [editableNode.id, editableNode],
]);

const board = renderer.renderFlowBoard({
  activeQuest: {
    id: 'quest:main-1',
    edges: [
      { fromNodeId: rootNode.id, toNodeId: runningNode.id, type: 'structural' },
      { fromNodeId: rootNode.id, toNodeId: waitingNode.id, type: 'structural' },
      { fromNodeId: rootNode.id, toNodeId: completedNode.id, type: 'structural' },
      { fromNodeId: rootNode.id, toNodeId: idleNode.id, type: 'structural' },
      { fromNodeId: rootNode.id, toNodeId: editableNode.id, type: 'structural' },
    ],
  },
  nodeMap,
  rootNode,
  state: {},
});

const rootOnlyNode = {
  ...rootNode,
  childNodeIds: [],
};
const rootOnlyBoard = renderer.renderFlowBoard({
  activeQuest: {
    id: 'quest:root-only',
    edges: [],
  },
  nodeMap: new Map([[rootOnlyNode.id, rootOnlyNode]]),
  rootNode: rootOnlyNode,
  state: {},
});

const mobileRenderer = context.window.MelodySyncTaskMapUi.createRenderer({
  documentRef,
  windowRef,
  isMobileQuestTracker: () => true,
});

const mobileBoard = mobileRenderer.renderFlowBoard({
  activeQuest: {
    id: 'quest:main-1',
    edges: [
      { fromNodeId: rootNode.id, toNodeId: runningNode.id, type: 'structural' },
      { fromNodeId: rootNode.id, toNodeId: waitingNode.id, type: 'structural' },
      { fromNodeId: rootNode.id, toNodeId: completedNode.id, type: 'structural' },
      { fromNodeId: rootNode.id, toNodeId: idleNode.id, type: 'structural' },
      { fromNodeId: rootNode.id, toNodeId: editableNode.id, type: 'structural' },
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
const editableFlowNode = findFlowNodeByTitle(board, '可改挂节点');
const mobileRootFlowNode = findFlowNodeByTitle(mobileBoard, '主任务');
const mobileRunningFlowNode = findFlowNodeByTitle(mobileBoard, '运行节点');

assert.ok(runningFlowNode, 'running flow node should render');
assert.ok(waitingFlowNode, 'waiting flow node should render');
assert.ok(completedFlowNode, 'completed flow node should render');
assert.ok(idleFlowNode, 'idle flow node should render');
assert.ok(editableFlowNode, 'editable flow node should render');
assert.ok(mobileRootFlowNode, 'mobile flow board should still render the root node');
assert.ok(mobileRunningFlowNode, 'mobile flow board should still render child nodes');
assert.equal(
  findFirstByClass(rootOnlyBoard, 'task-map-empty'),
  null,
  'root-only task maps should stay clean instead of showing a placeholder hint',
);
assert.equal(mobileRootFlowNode.style.getPropertyValue('width'), '150px', 'mobile root cards should use the compact width budget');
assert.equal(mobileRunningFlowNode.style.getPropertyValue('width'), '128px', 'mobile child cards should use the narrower width budget so wide task maps fit better');

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
  findFirstByClass(idleFlowNode, 'quest-task-flow-node-badge'),
  null,
  'non-current idle flow nodes should avoid rendering a redundant idle badge',
);

const reparentActionBtn = findFirst(editableFlowNode, (node) => node?.textContent === '挂到...');
assert.ok(reparentActionBtn, 'current active session nodes should expose a lightweight reparent entry');
reparentActionBtn.dispatchEvent({ type: 'click' });

const reparentComposer = findFirstByClass(editableFlowNode, 'quest-task-flow-reparent-composer');
assert.ok(reparentComposer, 'clicking the reparent action should open the inline chooser composer');
assert.equal(
  findFirstByClass(reparentComposer, 'quest-task-flow-reparent-option-path')?.textContent,
  '最近使用 · 目标任务 / 方案讨论',
  'reparent chooser should render the display path used for recent targets',
);

const handoffTrigger = findFirstByClass(board, 'quest-task-flow-edge-handoff-btn');
assert.ok(handoffTrigger, 'task-map edges should render a visible handoff trigger when both endpoints are sessions');
handoffTrigger.dispatchEvent({ type: 'click' });

const handoffPopover = findFirstByClass(board, 'quest-task-flow-edge-handoff-popover');
assert.ok(handoffPopover, 'clicking the edge handoff trigger should reveal the preview popover');
assert.equal(handoffPopover.hidden, false, 'handoff preview popover should open inline in the static fallback renderer');

const handoffConfirmBtn = findFirst(handoffPopover, (node) => node?.textContent === '确认传递');
assert.ok(handoffConfirmBtn, 'handoff popover should expose a confirm action');
await handoffConfirmBtn.dispatchEvent({ type: 'click' });

assert.deepEqual(
  handoffCalls[0],
  {
    sourceSessionId: 'main-1',
    targetSessionId: 'branch-running',
  },
  'confirming edge handoff should call the injected task handoff action with the source and target session ids',
);

console.log('test-workbench-task-map-ui: ok');
