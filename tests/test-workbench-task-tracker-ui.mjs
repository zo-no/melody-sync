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
    type: '',
    disabled: false,
    classList: createClassList(),
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    click() {
      listeners.get('click')?.({
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

const taskTrackerUiSource = readWorkbenchFrontendSource('task-tracker-ui.js');

const context = {
  console,
  document: {
    createElement: makeElement,
  },
  window: {},
};
context.globalThis = context;

vm.runInNewContext(taskTrackerUiSource, context, { filename: 'frontend-src/workbench/task-tracker-ui.js' });

const persistentHost = makeElement('div');
const renderer = context.window.MelodySyncTaskTrackerUi.createTrackerRenderer({
  documentRef: context.document,
  getPersistentActionsEl: () => persistentHost,
});

renderer.renderPersistentActions(null);
assert.equal(persistentHost.hidden, true, 'missing sessions should hide persistent actions');

renderer.renderPersistentActions(
  { id: 'session-main', archived: false },
  { onPromote() {} },
);
assert.deepEqual(
  persistentHost.children.map((child) => child.textContent),
  ['沉淀为长期项'],
  'plain sessions should expose the promote action',
);

let openLongTermCount = 0;
let attachLongTermCount = 0;
let dismissLongTermCount = 0;
renderer.renderPersistentActions(
  {
    id: 'session-suggested',
    sessionState: {
      longTerm: {
        lane: 'sessions',
        suggestion: {
          rootSessionId: 'long-term-root',
          title: 'MelodySync',
        },
      },
    },
  },
  {
    onAttachToLongTerm() { attachLongTermCount += 1; },
    onDismissLongTermSuggestion() { dismissLongTermCount += 1; },
  },
);
assert.deepEqual(
  persistentHost.children.map((child) => child.textContent),
  ['归入长期项目', '稍后'],
  'suggested long-term matches should expose only classify and dismiss actions',
);
persistentHost.children[0].click();
persistentHost.children[1].click();
assert.equal(attachLongTermCount, 1, 'attach action should stay wired');
assert.equal(dismissLongTermCount, 1, 'dismiss action should stay wired');

renderer.renderPersistentActions(
  {
    id: 'session-member',
    sessionState: {
      longTerm: {
        lane: 'long-term',
        role: 'member',
        rootSessionId: 'long-term-root',
      },
    },
  },
  {},
);
assert.deepEqual(
  persistentHost.children.map((child) => child.textContent),
  [],
  'attached long-term members should not expose a second long-term entry action',
);

let runCount = 0;
let toggleCount = 0;
let configureCount = 0;
renderer.renderPersistentActions(
  {
    id: 'session-recurring',
    persistent: {
      kind: 'recurring_task',
      state: 'active',
      recurring: { cadence: 'daily' },
    },
  },
  {
    onRun() { runCount += 1; },
    onToggle() { toggleCount += 1; },
    onToggleRecurring() { toggleCount += 1; },
    onConfigure() { configureCount += 1; },
  },
);
assert.deepEqual(
  persistentHost.children.map((child) => child.textContent),
  ['一键触发', '定时触发', '暂停循环', '设置'],
  'recurring tasks with active cadence should expose run, scheduled-toggle, recurring-toggle, and configure actions',
);
persistentHost.children[0].click();
persistentHost.children[2].click();
persistentHost.children[3].click();
assert.equal(runCount, 1, 'run action should stay wired');
assert.equal(toggleCount, 1, 'recurring toggle action should stay wired');
assert.equal(configureCount, 1, 'configure action should stay wired');

renderer.renderPersistentActions(
  {
    id: 'session-paused',
    persistent: {
      kind: 'recurring_task',
      state: 'paused',
      recurring: { cadence: 'daily' },
    },
  },
  {},
);
assert.equal(
  persistentHost.children[2]?.textContent,
  '循环触发',
  'paused recurring tasks should swap the recurring toggle label to resume',
);

renderer.renderPersistentActions(
  {
    id: 'session-skill',
    persistent: {
      kind: 'skill',
    },
  },
  {},
);
assert.deepEqual(
  persistentHost.children.map((child) => child.textContent),
  ['触发AI快捷按钮', '设置'],
  'skill persistent items should expose trigger and configure actions',
);

console.log('test-workbench-task-tracker-ui: ok');
