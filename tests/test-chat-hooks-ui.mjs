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
          settings: {
            persistence: 'file',
            storagePath: '/tmp/melody-sync/hooks.json',
            supportsEnableDisable: true,
          },
          layerDefinitions: [
            { id: 'boot', label: 'Boot Hooks', description: '实例首次启动、启动恢复、运行环境初始化相关的 hooks。' },
            { id: 'lifecycle', label: 'Lifecycle Hooks', description: '会话、Run、支线和完成闭环相关的生命周期派生处理。' },
            { id: 'delivery', label: 'Delivery Hooks', description: '对外通知、邮件、回调等外部交付副作用。' },
            { id: 'other', label: 'Other Hooks', description: '未归入标准生命周期层的 hooks。' },
          ],
          layerOrder: ['boot', 'lifecycle', 'delivery', 'other'],
          uiTargetDefinitions: [
            { id: 'session_stream', label: 'Session Stream', description: '在会话流中插入生命周期事件、提示卡和完成收据。' },
            { id: 'task_status_strip', label: 'Task Status Strip', description: '更新顶部轻状态条中的提示性状态信息。' },
            { id: 'task_action_panel', label: 'Task Action Panel', description: '更新输入区附近的行动建议和下一步提示。' },
            { id: 'task_map', label: 'Task Map Surface', description: '给任务地图添加提示性覆盖信息、入口和状态提示，但不拥有 node 真值。' },
            { id: 'task_list_rows', label: 'Task List Rows', description: '更新 GTD 任务列表中的任务名、分组标签和辅助文案，但不拥有顺序真值。' },
            { id: 'task_list_badges', label: 'Task List Badges', description: '更新任务列表中的徽标、状态点和轻量提示。' },
            { id: 'composer_assist', label: 'Composer Assist', description: '更新输入区附近的建议问句、快捷动作和补充上下文提示。' },
            { id: 'workspace_notices', label: 'Workspace Notices', description: '在工作区插入阶段性提示、完成收据和全局 notice。' },
            { id: 'settings_panels', label: 'Settings Panels', description: '在设置面板中展示 hook 能力、状态、解释和调试信息。' },
          ],
          uiReservedTruths: [
            { id: 'task_list_order', description: '任务列表顺序由 session-list-order contract 独立管理，hook 不应直接拥有排序真值。' },
            { id: 'task_map_nodes', description: '地图 node 投影由 durable state 驱动，hook 不应成为 node 真值来源。' },
          ],
          events: [
            'instance.first_boot',
            'instance.startup',
            'instance.resume',
            'session.created',
            'session.first_user_message',
            'run.started',
            'run.completed',
            'run.failed',
            'branch.suggested',
            'branch.opened',
            'branch.merged',
          ],
          eventDefinitions: [
            { id: 'instance.first_boot', label: '实例首次启动', description: '当前实例第一次启动且本地 memory/bootstrap 种子尚未初始化时。' },
            { id: 'instance.startup', label: '实例启动后', description: '服务启动完成、基础目录准备完毕之后。' },
            { id: 'instance.resume', label: '实例恢复后', description: '服务完成启动期恢复动作之后。' },
            { id: 'session.created', label: 'Session 创建后', description: '新 session 完成初始化并写入 metadata 之后。' },
            { id: 'session.first_user_message', label: '首条用户消息记录后', description: 'session 第一条真实用户消息进入历史之后。' },
            { id: 'run.started', label: 'Run 启动后', description: '新的 detached run 建立并进入执行流程之后。' },
            { id: 'run.completed', label: 'Run 完成后', description: 'Run 成功完成并且结果已经回写之后。' },
            { id: 'run.failed', label: 'Run 失败/取消后', description: 'Run 失败、终止或取消之后。' },
            { id: 'branch.suggested', label: '建议单独处理话题后', description: '检测到高置信上下文隔离话题，并产出候选支线生命周期事件之后。' },
            { id: 'branch.opened', label: '支线开启后', description: '新的支线 session/branch context 已持久化并进入处理状态之后。' },
            { id: 'branch.merged', label: '支线带回主线后', description: '支线结果已经回流到主线并写入 merge note 之后。' },
          ],
          hooks: [
            {
              id: 'builtin.first-boot-memory',
              eventPattern: 'instance.first_boot',
              label: '首次启动记忆初始化',
              description: '实例首次启动时创建最小 memory/bootstrap 种子文件。',
              builtIn: true,
              layer: 'boot',
              sourceModule: 'chat/hooks/first-boot-memory-hook.mjs',
              enabled: true,
            },
            {
              id: 'builtin.push-notification',
              eventPattern: 'run.completed',
              label: '推送通知',
              description: 'Run 完成后发送推送通知',
              builtIn: true,
              layer: 'delivery',
              sourceModule: 'chat/hooks/push-notification-hook.mjs',
              enabled: true,
            },
            {
              id: 'builtin.branch-candidates',
              eventPattern: 'branch.suggested',
              label: '支线任务推荐',
              description: '检测到需要单独处理的话题后，将候选支线写入会话生命周期事件。',
              builtIn: true,
              layer: 'lifecycle',
              sourceModule: 'chat/hooks/branch-candidates-hook.mjs',
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
assert.match(hooksPanelBody.innerHTML, /Hooks 是生命周期自动化，不是项目真值/, 'hooks settings should render the architecture summary');
assert.match(hooksPanelBody.innerHTML, /\/tmp\/melody-sync\/hooks\.json/, 'hooks settings should show the storage path');
assert.match(hooksPanelBody.innerHTML, /Boot Hooks/, 'hooks settings should group hooks by lifecycle layer');
assert.match(hooksPanelBody.innerHTML, /Delivery Hooks/, 'hooks settings should render the delivery layer');
assert.match(hooksPanelBody.innerHTML, /会话、Run、支线和完成闭环相关的生命周期派生处理/, 'hooks settings should use API-provided layer descriptions');
assert.match(hooksPanelBody.innerHTML, /首次启动记忆初始化/, 'hooks settings should render boot hooks');
assert.match(hooksPanelBody.innerHTML, /推送通知/, 'hooks settings should render the fetched hook labels');
assert.match(hooksPanelBody.innerHTML, /实例首次启动/, 'hooks settings should group hooks by instance lifecycle events');
assert.match(hooksPanelBody.innerHTML, /建议单独处理话题后/, 'hooks settings should group lifecycle hooks by the semantic branch.suggested event');
assert.match(hooksPanelBody.innerHTML, /待接入生命周期/, 'hooks settings should render uncovered lifecycle events');
assert.match(hooksPanelBody.innerHTML, /首条用户消息记录后/, 'hooks settings should show uncovered events when no builtin hooks are attached yet');
assert.match(hooksPanelBody.innerHTML, /chat\/hooks\/first-boot-memory-hook\.mjs/, 'hooks settings should render the source module path');
assert.match(hooksPanelBody.innerHTML, /Run 完成后/, 'hooks settings should group hooks by lifecycle event');
assert.match(hooksPanelBody.innerHTML, /结果已经回写之后/, 'hooks settings should render the event description returned by the API');
assert.match(hooksPanelBody.innerHTML, /Session Stream/, 'hooks settings should render allowed hook UI targets');
assert.match(hooksPanelBody.innerHTML, /Task List Rows/, 'hooks settings should render broader UI surfaces hooks can operate on');
assert.match(hooksPanelBody.innerHTML, /task_list_order/, 'hooks settings should render reserved UI truths that hooks must not own');

hooksOverlayClose.click();
assert.equal(hooksOverlay.hidden, true, 'close button should hide the hooks overlay');
assert.equal(documentBody.classList.contains('hooks-overlay-open'), false, 'close button should clear the body state');

console.log('test-chat-hooks-ui: ok');
