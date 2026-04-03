#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const modelSource = readFileSync(join(repoRoot, 'static/chat/workbench/node-settings-model.js'), 'utf8');
const uiSource = readFileSync(join(repoRoot, 'static/chat/workbench/node-settings-ui.js'), 'utf8');

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

function makeElement() {
  const listeners = new Map();
  return {
    hidden: false,
    innerHTML: '',
    classList: makeClassList(),
    dataset: {},
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      const handlers = listeners.get(event.type) || [];
      for (const handler of handlers) {
        handler.call(this, event);
      }
    },
    setAttribute(name, value) {
      this[name] = value;
    },
  };
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

const bodyEl = makeElement();
const fetchCalls = [];

const context = {
  console,
  fetch: async (url) => {
    fetchCalls.push(url);
    return {
      ok: true,
      async json() {
        return {
          nodeLanes: ['main', 'branch', 'side'],
          nodeRoles: ['state', 'action', 'summary'],
          nodeMergePolicies: ['replace-latest', 'append'],
          nodeInteractions: ['open-session', 'create-branch', 'none'],
          nodeViewTypes: ['flow-node', 'markdown', 'html', 'iframe'],
          nodeSurfaceSlots: ['task-map', 'composer-suggestions'],
          nodeTaskCardBindingKeys: ['mainGoal', 'goal', 'candidateBranches', 'summary', 'checkpoint', 'nextSteps'],
          builtInNodeKinds: ['main', 'branch', 'candidate', 'done'],
          nodeKindDefinitions: [
            { id: 'main', label: '主任务', lane: 'main', role: 'state', mergePolicy: 'replace-latest', builtIn: true, editable: false, source: 'builtin' },
            { id: 'branch', label: '子任务', lane: 'branch', role: 'state', mergePolicy: 'append', builtIn: true, editable: false, source: 'builtin' },
            { id: 'candidate', label: '建议子任务', lane: 'branch', role: 'action', mergePolicy: 'replace-latest', builtIn: true, editable: false, source: 'builtin' },
            { id: 'done', label: '收束', lane: 'main', role: 'summary', mergePolicy: 'replace-latest', builtIn: true, editable: false, source: 'builtin' },
            {
              id: 'review-note',
              label: '复盘节点',
              description: '用于阶段复盘。',
              lane: 'side',
              role: 'summary',
              mergePolicy: 'append',
              builtIn: false,
              editable: true,
              source: 'custom',
              composition: {
                defaultInteraction: 'none',
                defaultViewType: 'markdown',
                surfaceBindings: ['task-map'],
                taskCardBindings: ['summary'],
              },
            },
          ],
        };
      },
    };
  },
  window: {},
};
context.globalThis = context;
context.window = context;

vm.runInNewContext(modelSource, context, { filename: 'static/chat/workbench/node-settings-model.js' });
vm.runInNewContext(uiSource, context, { filename: 'static/chat/workbench/node-settings-ui.js' });

const controller = context.MelodySyncTaskMapNodeSettingsUi.createController({
  bodyEl,
  documentRef: makeElement(),
});
controller.activate();
await flushMicrotasks();
await flushMicrotasks();

assert.deepEqual(fetchCalls, ['/api/workbench/node-definitions']);
assert.match(bodyEl.innerHTML, /系统节点/);
assert.match(bodyEl.innerHTML, /自定义节点/);
assert.match(bodyEl.innerHTML, /主任务/);
assert.match(bodyEl.innerHTML, /<code class="task-map-node-id">main<\/code>/);
assert.match(bodyEl.innerHTML, /复盘节点/);
assert.match(bodyEl.innerHTML, /<code class="task-map-node-id">review-note<\/code>/);
assert.match(bodyEl.innerHTML, /新增自定义节点/);
assert.match(bodyEl.innerHTML, /创建后不可修改/);
assert.match(bodyEl.innerHTML, /默认视图/);
assert.match(bodyEl.innerHTML, /展示位置/);
assert.match(bodyEl.innerHTML, /任务卡回写/);
assert.doesNotMatch(bodyEl.innerHTML, /settings-app-card/, 'node tab should not fall back to legacy app-card layout');
assert.doesNotMatch(bodyEl.innerHTML, /系统内建 · 主泳道 · 状态节点/, 'node tab should no longer foreground internal node taxonomy in the list');
assert.doesNotMatch(bodyEl.innerHTML, /系统 4 个 · 自定义 1 个/, 'node tab should not repeat a top-level summary count above the grouped sections');

console.log('test-chat-workbench-node-settings-ui: ok');
