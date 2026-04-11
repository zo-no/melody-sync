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

function createClassList() {
  const values = new Set();
  return {
    add(...tokens) {
      tokens.filter(Boolean).forEach((token) => values.add(token));
    },
    remove(...tokens) {
      tokens.filter(Boolean).forEach((token) => values.delete(token));
    },
    contains(token) {
      return values.has(token);
    },
    toggle(token, force) {
      if (force === true) {
        values.add(token);
        return true;
      }
      if (force === false) {
        values.delete(token);
        return false;
      }
      if (values.has(token)) {
        values.delete(token);
        return false;
      }
      values.add(token);
      return true;
    },
    setFromString(value) {
      values.clear();
      String(value || '').split(/\s+/).filter(Boolean).forEach((token) => values.add(token));
    },
  };
}

function makeElement(tag = 'div') {
  let classNameValue = '';
  let innerHtmlValue = '';
  const listeners = new Map();
  const element = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    hidden: false,
    textContent: '',
    value: '',
    type: '',
    placeholder: '',
    rows: 0,
    dataset: {},
    disabled: false,
    classList: createClassList(),
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    click() {
      listeners.get('click')?.({
        target: element,
        preventDefault() {},
        stopPropagation() {},
      });
    },
  };

  Object.defineProperty(element, 'className', {
    get() {
      return classNameValue;
    },
    set(value) {
      classNameValue = String(value || '');
      element.classList.setFromString(classNameValue);
    },
  });

  Object.defineProperty(element, 'innerHTML', {
    get() {
      return innerHtmlValue;
    },
    set(value) {
      innerHtmlValue = String(value || '');
      element.children = [];
      if (!innerHtmlValue) {
        element.textContent = '';
      }
    },
  });

  return element;
}

function findAllByClass(root, className) {
  const matches = [];
  function visit(node) {
    if (!node) return;
    if (node.classList?.contains(className)) {
      matches.push(node);
    }
    for (const child of node.children || []) {
      visit(child);
    }
  }
  visit(root);
  return matches;
}

const source = readWorkbenchFrontendSource('persistent-editor-ui.js');
assert.match(source, /创建支线执行/, 'persistent editor should expose branch-spawn execution mode');
const context = {
  console,
  document: {
    createElement: makeElement,
  },
  window: {},
};
context.globalThis = context;

vm.runInNewContext(source, context, { filename: 'frontend-src/workbench/persistent-editor-ui.js' });

const renderer = context.window.MelodySyncPersistentEditorUi.createRenderer({
  documentRef: context.document,
  cloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  },
  formatRuntimeSummary(runtime) {
    return String(runtime?.tool || '').trim() || '未固定';
  },
});

const host = makeElement('div');
renderer.renderPersistentEditorModal(host, {
  draft: {
    sessionId: 'session-persistent',
    mode: 'promote',
    editorStep: 'details',
    kind: 'recurring_task',
    digestTitle: '每小时检查',
    digestSummary: '继续优化任务图',
    runPrompt: '检查并优化',
    scheduledEnabled: false,
    scheduled: {
      runAtLocal: '',
      timezone: 'Asia/Shanghai',
    },
    recurringEnabled: true,
    recurring: {
      cadence: 'weekly',
      timeOfDay: '09:30',
      weekdays: [1, 3],
      timezone: 'Asia/Shanghai',
    },
    knowledgeBasePath: '/tmp/knowledge-base',
    manualMode: 'follow_current',
    manualRuntime: null,
    scheduleMode: 'pinned',
    scheduleRuntime: { tool: 'codex' },
  },
  currentRuntime: { tool: 'codex' },
  onClose() {},
  onSave() {},
});

assert.equal(host.hidden, false, 'rendering the editor should reveal the host');
assert.equal(findAllByClass(host, 'operation-record-persistent-editor').length, 1, 'renderer should mount the inline editor shell');
assert.equal(findAllByClass(host, 'operation-record-kind-btn').length, 5, 'renderer should show four task kind buttons plus one trigger toggle for recurring_task');
assert.equal(findAllByClass(host, 'operation-record-weekday-btn').length, 7, 'weekly cadence should render weekday toggles');
assert.equal(
  findAllByClass(host, 'operation-record-persistent-section-title').some((node) => node.textContent === '长期闭环'),
  true,
  'recurring-task editor should render the long-term loop section',
);
assert.equal(
  findAllByClass(host, 'modal-btn').some((node) => node.textContent === '保存为长期项'),
  true,
  'promote mode should keep the save CTA wording',
);

renderer.clearPersistentEditorModal(host);
assert.equal(host.hidden, true, 'clearing the modal should hide the host');
assert.equal(host.children.length, 0, 'clearing the modal should remove rendered content');

console.log('test-workbench-persistent-editor-ui: ok');
