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
      String(value || '')
        .split(/\s+/)
        .filter(Boolean)
        .forEach((token) => values.add(token));
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
    value: '',
    rows: 0,
    disabled: false,
    parentNode: null,
    classList: createClassList(),
    appendChild(child) {
      if (child && typeof child === 'object') {
        child.parentNode = this;
      }
      this.children.push(child);
      return child;
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    click(extra = {}) {
      listeners.get('click')?.({
        target: this,
        preventDefault() {},
        stopPropagation() {},
        ...extra,
      });
    },
    setAttribute() {},
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
    if (!node || typeof node !== 'object') return;
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

const persistentEditorSource = readWorkbenchFrontendSource('persistent-editor-ui.js');
const operationRecordSource = readWorkbenchFrontendSource('operation-record-ui.js');

assert.match(
  operationRecordSource,
  /payload\.scheduled\s*=\s*null/,
  'operation-record payloads should explicitly clear disabled scheduled triggers',
);
assert.match(
  operationRecordSource,
  /payload\.recurring\s*=\s*null/,
  'operation-record payloads should explicitly clear disabled recurring triggers',
);
assert.match(
  operationRecordSource,
  /mode:\s*draft\.executionMode === "spawn_session" \? "spawn_session" : "in_place"/,
  'operation-record payloads should carry the selected persistent execution mode',
);

const body = makeElement('body');
const documentListeners = new Map();
const context = {
  console,
  Intl,
  JSON,
  document: {
    body,
    createElement: makeElement,
    addEventListener(type, handler) {
      documentListeners.set(type, handler);
    },
  },
  window: {},
};
context.globalThis = context;

vm.runInNewContext(persistentEditorSource, context, {
  filename: 'frontend-src/workbench/persistent-editor-ui.js',
});
vm.runInNewContext(operationRecordSource, context, {
  filename: 'frontend-src/workbench/operation-record-ui.js',
});

const session = {
  id: 'session-main',
  name: '需求线程',
};

const controller = context.window.MelodySyncOperationRecordUi.createController({
  bodyEl: body,
  documentRef: context.document,
  windowRef: context.window,
  getFocusedSessionId() {
    return session.id;
  },
  getFocusedSessionRecord() {
    return session;
  },
  dispatchAction: async () => true,
});

await controller.openPersistentEditor({ mode: 'promote' });

assert.equal(body.children.length, 1, 'opening the persistent editor should append one host to the body');
const host = body.children[0];
assert.equal(host.hidden, false, 'opening the persistent editor should reveal the host');
assert.equal(
  findAllByClass(host, 'operation-record-persistent-editor').length,
  1,
  'opening the persistent editor should render the editor shell into the host',
);
assert.equal(
  findAllByClass(host, 'persistent-editor-kind-card').length,
  4,
  'promote mode should start on the four-kind picker step',
);

host.click();
assert.equal(host.hidden, true, 'clicking the backdrop should close the persistent editor host');
assert.equal(host.children.length, 0, 'closing the editor should clear rendered content');

console.log('test-workbench-operation-record-ui: ok');
