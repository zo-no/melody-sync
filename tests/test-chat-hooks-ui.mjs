#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const hooksUiSource = readFileSync(join(repoRoot, 'static/chat/hooks-ui.js'), 'utf8');

function makeEventTarget() {
  const listeners = new Map();
  return {
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
    click() {
      this.dispatchEvent({ type: 'click', target: this });
    },
  };
}

function makeBody() {
  const classes = new Set();
  return {
    classList: {
      add(token) {
        classes.add(token);
      },
      remove(token) {
        classes.delete(token);
      },
      contains(token) {
        return classes.has(token);
      },
    },
  };
}

function makeHooksPanelBody() {
  const target = makeEventTarget();
  target._inputs = [];
  target._innerHTML = '';
  Object.defineProperty(target, 'innerHTML', {
    get() {
      return target._innerHTML;
    },
    set(value) {
      target._innerHTML = String(value);
      const ids = Array.from(target._innerHTML.matchAll(/data-hook-id="([^"]+)"/g)).map((match) => match[1]);
      target._inputs = ids.map((hookId) => {
        const input = makeEventTarget();
        input.dataset = { hookId };
        input.checked = true;
        return input;
      });
    },
  });
  target.querySelectorAll = function querySelectorAll(selector) {
    if (selector === 'input[data-hook-id]') return target._inputs;
    return [];
  };
  return target;
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

const hooksPanelBody = makeHooksPanelBody();
const hooksOverlay = makeEventTarget();
hooksOverlay.hidden = true;
const hooksSettingsBtn = makeEventTarget();
const hooksOverlayClose = makeEventTarget();
const documentBody = makeBody();

const documentTarget = makeEventTarget();
documentTarget.body = documentBody;
documentTarget.getElementById = function getElementById(id) {
  switch (id) {
    case 'hooksOverlay':
      return hooksOverlay;
    case 'hooksSettingsBtn':
      return hooksSettingsBtn;
    case 'hooksOverlayClose':
      return hooksOverlayClose;
    case 'hooksPanelBody':
      return hooksPanelBody;
    default:
      return null;
  }
};

const fetchCalls = [];
const context = {
  console,
  document: documentTarget,
  fetch: async (url) => {
    fetchCalls.push(url);
    return {
      ok: true,
      async json() {
        return {
          events: ['session.created', 'run.started', 'run.completed', 'run.failed'],
          eventDefinitions: [
            { id: 'session.created', label: 'Session 创建后', description: '新 session 完成初始化并写入 metadata 之后。' },
            { id: 'run.started', label: 'Run 启动后', description: '新的 detached run 建立并进入执行流程之后。' },
            { id: 'run.completed', label: 'Run 完成后', description: 'Run 成功完成并且结果已经回写之后。' },
            { id: 'run.failed', label: 'Run 失败/取消后', description: 'Run 失败、终止或取消之后。' },
          ],
          hooks: [
            {
              id: 'builtin.push-notification',
              eventPattern: 'run.completed',
              label: '推送通知',
              description: 'Run 完成后发送推送通知',
              builtIn: true,
              enabled: true,
            },
            {
              id: 'builtin.workbench-sync-on-fail',
              eventPattern: 'run.failed',
              label: '地图同步（失败时）',
              description: 'Run 失败/取消时也同步地图状态',
              builtIn: true,
              enabled: true,
            },
          ],
        };
      },
    };
  },
};

context.window = context;
context.globalThis = context;

vm.runInNewContext(hooksUiSource, context, { filename: 'static/chat/hooks-ui.js' });

hooksSettingsBtn.click();
await flushMicrotasks();
await flushMicrotasks();

assert.equal(hooksOverlay.hidden, false, 'hooks settings click should open the overlay');
assert.equal(documentBody.classList.contains('hooks-overlay-open'), true, 'opening hooks settings should tag the body state');
assert.deepEqual(fetchCalls, ['/api/hooks'], 'opening hooks settings should fetch the hooks metadata exactly once');
assert.match(hooksPanelBody.innerHTML, /推送通知/, 'hooks settings should render the fetched hook labels');
assert.match(hooksPanelBody.innerHTML, /Run 完成后/, 'hooks settings should group hooks by lifecycle event');
assert.match(hooksPanelBody.innerHTML, /结果已经回写之后/, 'hooks settings should render the event description returned by the API');

hooksOverlayClose.click();
assert.equal(hooksOverlay.hidden, true, 'close button should hide the hooks overlay');
assert.equal(documentBody.classList.contains('hooks-overlay-open'), false, 'close button should clear the body state');

console.log('test-chat-hooks-ui: ok');
