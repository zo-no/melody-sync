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
  const listeners = new Map();
  const element = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    textContent: '',
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

const source = readWorkbenchFrontendSource('operation-record-summary-ui.js');
const context = {
  console,
  document: {
    createElement: makeElement,
  },
  window: {},
};
context.globalThis = context;

vm.runInNewContext(source, context, { filename: 'frontend-src/workbench/operation-record-summary-ui.js' });

const renderer = context.window.MelodySyncOperationRecordSummaryUi.createRenderer({
  documentRef: context.document,
  clipText(value, max = 120) {
    const text = String(value || '').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  },
});

let runCount = 0;
let toggleCount = 0;
let configureCount = 0;
const header = renderer.buildPersistentHeader(
  {
    name: '每小时任务图巡检',
    persistent: {
      kind: 'recurring_task',
      state: 'paused',
    },
  },
  {
    onRun() { runCount += 1; },
    onToggle() { toggleCount += 1; },
    onConfigure() { configureCount += 1; },
  },
);

assert.equal(header.classList.contains('operation-record-session-header'), true, 'header renderer should keep the same shell class');
const actionButtons = findAllByClass(header, 'operation-record-action-btn');
assert.deepEqual(
  actionButtons.map((node) => node.textContent),
  ['立即执行', '恢复周期', '设置'],
  'recurring summaries should expose run, toggle, and configure actions',
);
actionButtons[0].click();
actionButtons[1].click();
actionButtons[2].click();
assert.equal(runCount, 1, 'run handler should stay wired');
assert.equal(toggleCount, 1, 'toggle handler should stay wired');
assert.equal(configureCount, 1, 'configure handler should stay wired');

const digestCard = renderer.buildPersistentDigestCard({
  persistent: {
    digest: {
      title: '每小时任务图巡检',
      summary: '继续优化任务地图的 React 架构。',
      keyPoints: ['保持功能不变', '每小时巡检'],
    },
  },
});
assert.equal(digestCard.classList.contains('operation-record-persistent-card'), true, 'digest renderer should keep the same card class');
assert.equal(
  findAllByClass(digestCard, 'operation-record-persistent-summary').some((node) => node.textContent.includes('长期摘要')),
  true,
  'digest renderer should keep the summary heading',
);
assert.equal(
  findAllByClass(digestCard, 'operation-record-persistent-list').some((node) => node.textContent.includes('每小时任务图巡检')),
  true,
  'digest renderer should keep the digest title text',
);

console.log('test-workbench-operation-record-summary-ui: ok');
