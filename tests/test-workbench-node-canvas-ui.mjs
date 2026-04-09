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
    join(repoRoot, 'frontend', 'workbench', filename),
    join(repoRoot, 'static', 'frontend', 'workbench', filename),
  ];
  const targetPath = candidates.find((candidate) => existsSync(candidate));
  if (!targetPath) {
    throw new Error(`Workbench frontend source not found for ${filename}`);
  }
  return readFileSync(targetPath, 'utf8');
}

const richViewSource = readWorkbenchFrontendSource('node-rich-view-ui.js');
const canvasSource = readWorkbenchFrontendSource('node-canvas-ui.js');

function makeClassList() {
  const tokens = new Set();
  return {
    add(...values) {
      values.filter(Boolean).forEach((value) => tokens.add(value));
    },
    remove(...values) {
      values.filter(Boolean).forEach((value) => tokens.delete(value));
    },
    toggle(value, force) {
      if (force === true) {
        tokens.add(value);
        return true;
      }
      if (force === false) {
        tokens.delete(value);
        return false;
      }
      if (tokens.has(value)) {
        tokens.delete(value);
        return false;
      }
      tokens.add(value);
      return true;
    },
    contains(value) {
      return tokens.has(value);
    },
  };
}

function makeElement(tagName = 'div') {
  const listeners = new Map();
  return {
    tagName: String(tagName || 'div').toUpperCase(),
    hidden: false,
    className: '',
    textContent: '',
    innerHTML: '',
    title: '',
    children: [],
    style: {
      _values: new Map(),
      setProperty(name, value) {
        this._values.set(name, String(value));
      },
      removeProperty(name) {
        this._values.delete(name);
      },
      getPropertyValue(name) {
        return this._values.get(name) || '';
      },
    },
    classList: makeClassList(),
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    trigger(type, event = {}) {
      const handlers = listeners.get(type) || [];
      for (const handler of handlers) {
        handler(event);
      }
    },
    click() {
      this.trigger('click', { preventDefault() {}, stopPropagation() {}, currentTarget: this, target: this });
    },
    setAttribute(name, value) {
      this[name] = String(value);
    },
  };
}

function makeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    trigger(type, event = {}) {
      const handlers = listeners.get(type) || [];
      for (const handler of handlers) {
        handler(event);
      }
    },
  };
}

const context = {
  console,
  document: {
    ...makeEventTarget(),
    createElement(tagName) {
      return makeElement(tagName);
    },
  },
  window: {
    ...makeEventTarget(),
    marked: {
      parse(value) {
        return `<p>${String(value || '').trim()}</p>`;
      },
    },
  },
};
context.globalThis = context;
context.window.window = context.window;

vm.runInNewContext(richViewSource, context, { filename: 'workbench/node-rich-view-ui.js' });
vm.runInNewContext(canvasSource, context, { filename: 'workbench/node-canvas-ui.js' });

const railEl = makeElement('section');
const railContainerEl = makeElement('aside');
const headerEl = makeElement('div');
const titleEl = makeElement('div');
const summaryEl = makeElement('div');
const bodyEl = makeElement('div');
const expandBtn = makeElement('button');
const closeBtn = makeElement('button');
let closed = 0;

const controller = context.window.MelodySyncWorkbenchNodeCanvasUi.createController({
  railContainerEl,
  railEl,
  headerEl,
  titleEl,
  summaryEl,
  bodyEl,
  expandBtn,
  closeBtn,
  documentRef: context.document,
  windowRef: context.window,
  onClose() {
    closed += 1;
  },
});

assert.equal(controller.isOpen(), false, 'node canvas should initialize in a closed state');

const rendered = controller.renderNode({
  id: 'goal-panel:main-1',
  title: '构建 node 驱动页面表达',
  summary: '让 rich view 真正显示在右侧 node canvas',
  view: {
    type: 'markdown',
    content: '## 目标节点',
  },
});

assert.equal(rendered, true);
assert.equal(controller.isOpen(), true, 'rendering a rich-view node should open the node canvas rail');
assert.equal(titleEl.textContent, '构建 node 驱动页面表达');
assert.equal(summaryEl.hidden, false);
assert.equal(summaryEl.textContent, '让 rich view 真正显示在右侧 node canvas');
assert.equal(bodyEl.children.length, 1);
assert.equal(bodyEl.children[0].className, 'quest-task-flow-node-rich quest-task-flow-node-rich-markdown');
assert.equal(bodyEl.children[0].children[0].innerHTML, '<p>## 目标节点</p>');

expandBtn.click();
assert.equal(controller.isExpanded(), true, 'expand button should switch the node canvas into expanded mode');
assert.equal(railEl.classList.contains('is-expanded'), true);
assert.equal(railContainerEl.classList.contains('is-canvas-expanded'), true);
assert.equal(expandBtn.textContent, '收起');

headerEl.trigger('mousedown', { clientX: 10, clientY: 20, target: headerEl });
context.window.trigger('mousemove', { clientX: 46, clientY: 74 });
context.window.trigger('mouseup', {});
assert.equal(railEl.style.getPropertyValue('--task-canvas-drag-x'), '36px');
assert.equal(railEl.style.getPropertyValue('--task-canvas-drag-y'), '54px');

expandBtn.click();
assert.equal(controller.isExpanded(), false, 'expand button should collapse the expanded node canvas back into the rail');
assert.equal(railEl.classList.contains('is-expanded'), false);
assert.equal(railContainerEl.classList.contains('is-canvas-expanded'), false);
assert.equal(railEl.style.getPropertyValue('--task-canvas-drag-x'), '');
assert.equal(railEl.style.getPropertyValue('--task-canvas-drag-y'), '');

closeBtn.click();
assert.equal(controller.isOpen(), false, 'closing should hide the node canvas rail');
assert.equal(closed, 1, 'closing should call the provided onClose hook');

const delegatedController = {
  renderNode() { return 'react-rendered'; },
  clear() {},
  isOpen() { return true; },
  isExpanded() { return false; },
  hasCanvasView() { return true; },
  resolveNodeView() { return { type: 'markdown' }; },
};
const delegatedCalls = [];
context.window.MelodySyncWorkbenchReactUi = {
  createNodeCanvasController(options) {
    delegatedCalls.push(options);
    return delegatedController;
  },
};
context.MelodySyncWorkbenchReactUi = context.window.MelodySyncWorkbenchReactUi;

const delegated = context.window.MelodySyncWorkbenchNodeCanvasUi.createController({
  railEl: makeElement('section'),
  bodyEl: makeElement('div'),
  documentRef: context.document,
  windowRef: context.window,
});
assert.equal(
  delegated,
  delegatedController,
  'node canvas ui should prefer the shared React workbench controller when available',
);
assert.equal(delegatedCalls.length, 1, 'adapter path should delegate creation to the React workbench bundle once');

console.log('test-workbench-node-canvas-ui: ok');
