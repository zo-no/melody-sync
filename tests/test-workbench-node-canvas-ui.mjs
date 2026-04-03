#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const richViewSource = readFileSync(
  join(repoRoot, 'static', 'chat', 'workbench', 'node-rich-view-ui.js'),
  'utf8',
);
const canvasSource = readFileSync(
  join(repoRoot, 'static', 'chat', 'workbench', 'node-canvas-ui.js'),
  'utf8',
);

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
    classList: makeClassList(),
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    click() {
      const handlers = listeners.get('click') || [];
      for (const handler of handlers) {
        handler({ preventDefault() {}, stopPropagation() {}, currentTarget: this, target: this });
      }
    },
    setAttribute(name, value) {
      this[name] = String(value);
    },
  };
}

const context = {
  console,
  document: {
    createElement(tagName) {
      return makeElement(tagName);
    },
  },
  window: {
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
const titleEl = makeElement('div');
const summaryEl = makeElement('div');
const bodyEl = makeElement('div');
const closeBtn = makeElement('button');
let closed = 0;

const controller = context.window.MelodySyncWorkbenchNodeCanvasUi.createController({
  railEl,
  titleEl,
  summaryEl,
  bodyEl,
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

closeBtn.click();
assert.equal(controller.isOpen(), false, 'closing should hide the node canvas rail');
assert.equal(closed, 1, 'closing should call the provided onClose hook');

console.log('test-workbench-node-canvas-ui: ok');
