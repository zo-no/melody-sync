#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const bootstrapSource = readFileSync(join(repoRoot, 'static', 'frontend', 'core', 'bootstrap.js'), 'utf8');

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = source.indexOf('(', start);
  assert.notEqual(paramsStart, -1, `${functionName} should have parameters`);
  let paramsDepth = 0;
  let braceStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        braceStart = source.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(braceStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

const updateFrontendRefreshUiSource = extractFunctionSource(bootstrapSource, 'updateFrontendRefreshUi');

function createButton() {
  return {
    hidden: true,
    title: '',
    attributes: new Map([['aria-busy', 'true']]),
    classList: {
      values: new Set(),
      toggle(name, force) {
        if (force) this.values.add(name);
        else this.values.delete(name);
      },
      contains(name) {
        return this.values.has(name);
      },
    },
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
  };
}

const context = {
  console,
  bootstrapT(key) {
    if (key === 'status.frontendUpdateReady') return '有新前端版本，点这里刷新';
    if (key === 'status.frontendReloadLatest') return '刷新到最新前端';
    return key;
  },
  refreshFrontendBtn: createButton(),
  newerBuildInfo: null,
};
context.globalThis = context;

vm.runInNewContext(
  `${updateFrontendRefreshUiSource}\nglobalThis.updateFrontendRefreshUi = updateFrontendRefreshUi;`,
  context,
  { filename: 'frontend/core/bootstrap.js' },
);

context.updateFrontendRefreshUi();
assert.equal(context.refreshFrontendBtn.hidden, true, 'refresh button should stay hidden when no update is pending');
assert.equal(context.refreshFrontendBtn.title, '刷新到最新前端');
assert.equal(context.refreshFrontendBtn.attributes.get('aria-label'), '刷新到最新前端');
assert.equal(context.refreshFrontendBtn.classList.contains('ready'), false, 'refresh button should not be highlighted without a pending update');
assert.equal(context.refreshFrontendBtn.attributes.has('aria-busy'), false, 'refresh button should clear busy state when no update is pending');

context.newerBuildInfo = { assetVersion: 'build-2' };
context.updateFrontendRefreshUi();
assert.equal(context.refreshFrontendBtn.hidden, false, 'refresh button should remain visible when an update is pending');
assert.equal(context.refreshFrontendBtn.title, '有新前端版本，点这里刷新');
assert.equal(context.refreshFrontendBtn.attributes.get('aria-label'), '有新前端版本，点这里刷新');
assert.equal(context.refreshFrontendBtn.classList.contains('ready'), true, 'refresh button should highlight when an update is pending');

console.log('test-chat-refresh-button-ui: ok');
