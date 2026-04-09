#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

function readFrontendSource(...segments) {
  const candidates = [
    join(repoRoot, 'frontend-src', ...segments),
    join(repoRoot, 'frontend', ...segments),
  ];
  const targetPath = candidates.find((candidate) => existsSync(candidate));
  if (!targetPath) {
    throw new Error(`Frontend source not found for ${segments.join('/')}`);
  }
  return readFileSync(targetPath, 'utf8');
}

const settingsUiSource = readFrontendSource('settings', 'ui.js');
const hooksModelSource = readFrontendSource('settings', 'hooks', 'model.js');
const hooksUiSource = readFrontendSource('settings', 'hooks', 'ui.js');

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

function makeEventTarget() {
  const listeners = new Map();
  return {
    hidden: false,
    dataset: {},
    classList: makeClassList(),
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
    setAttribute(name, value) {
      this[name] = value;
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
const settingsTabHooks = makeEventTarget();
settingsTabHooks.dataset.settingsTab = 'hooks';
const settingsTabNodes = makeEventTarget();
settingsTabNodes.dataset.settingsTab = 'nodes';
const settingsPanelHooks = makeEventTarget();
settingsPanelHooks.dataset.settingsPanel = 'hooks';
const settingsPanelNodes = makeEventTarget();
settingsPanelNodes.dataset.settingsPanel = 'nodes';
const documentBody = { classList: makeClassList() };

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
    case 'settingsTabHooks':
      return settingsTabHooks;
    case 'settingsTabNodes':
      return settingsTabNodes;
    case 'settingsPanelHooks':
      return settingsPanelHooks;
    case 'settingsPanelNodes':
      return settingsPanelNodes;
    default:
      return null;
  }
};
documentTarget.querySelectorAll = function querySelectorAll(selector) {
  if (selector === '[data-settings-tab]') {
    return [settingsTabHooks, settingsTabNodes];
  }
  if (selector === '[data-settings-panel]') {
    return [settingsPanelHooks, settingsPanelNodes];
  }
  return [];
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
          phaseDefinitions: [
            { id: 'startup', label: '启动准备', description: '实例启动、首次初始化和恢复相关的闭环起点。' },
            { id: 'entry', label: '进入任务', description: '任务建立并首次进入真实对话的阶段。' },
            { id: 'execution', label: '本轮处理', description: '任务进入本轮处理并持续推进的阶段。' },
            { id: 'closeout', label: '收尾与分流', description: '执行结束后的命名、通知、用户接手、失败回执和支线建议。' },
            { id: 'branch_followup', label: '支线处理与回流', description: '支线被打开后继续推进，并在合适时回流主线。' },
          ],
          phaseOrder: ['startup', 'entry', 'execution', 'closeout', 'branch_followup'],
          events: [
            'instance.first_boot',
            'instance.startup',
            'instance.resume',
            'session.created',
            'session.first_user_message',
            'session.waiting_user',
            'session.completed',
            'run.started',
            'run.completed',
            'run.failed',
            'branch.suggested',
            'branch.opened',
            'branch.merged',
          ],
          eventDefinitions: [
            { id: 'instance.first_boot', scope: 'instance', phase: 'startup', label: '实例首次启动', description: '当前实例第一次启动且本地 memory/bootstrap 种子尚未初始化时。' },
            { id: 'instance.startup', scope: 'instance', phase: 'startup', label: '实例启动完成', description: '服务启动完成、基础目录准备完毕之后。' },
            { id: 'instance.resume', scope: 'instance', phase: 'startup', label: '实例恢复完成', description: '服务完成启动期恢复动作之后。' },
            { id: 'session.created', scope: 'session', phase: 'entry', label: '新建任务', description: '新任务完成初始化并写入元数据之后。' },
            { id: 'session.first_user_message', scope: 'session', phase: 'entry', label: '首次发送消息', description: '任务第一条真实用户消息进入历史之后。' },
            { id: 'session.waiting_user', scope: 'session', phase: 'closeout', label: '需要用户接手', description: '任务进入需要用户确认、选择、补资料或手动验证的状态之后。' },
            { id: 'session.completed', scope: 'session', phase: 'closeout', label: '任务完成', description: '任务 workflowState 从非 done 变为 done 之后。' },
            { id: 'run.started', scope: 'run', phase: 'execution', label: '开始执行', description: '新的一次执行建立并进入处理流程之后。' },
            { id: 'run.completed', scope: 'run', phase: 'closeout', label: '执行完成', description: '一次执行成功完成并且结果已经回写之后。' },
            { id: 'run.failed', scope: 'run', phase: 'closeout', label: '执行失败或取消', description: '一次执行失败、终止或取消之后。' },
            { id: 'branch.suggested', scope: 'branch', phase: 'closeout', label: '识别支线建议', description: '检测到适合独立处理的话题，并产出候选支线事件之后。' },
            { id: 'branch.opened', scope: 'branch', phase: 'branch_followup', label: '开启', description: '新的支线任务和 branch context 已持久化并进入处理状态之后。' },
            { id: 'branch.merged', scope: 'branch', phase: 'branch_followup', label: '支线合并回主线', description: '支线结果已经回流主线并写入合并记录之后。' },
          ],
          settings: {
            storagePath: '/Users/test/vault/00-🤖agent/hooks/settings.json',
            customDesignPath: '/Users/test/vault/00-🤖agent/hooks/custom-hooks.json',
          },
          hooks: [
            {
              id: 'builtin.first-boot-memory',
              eventPattern: 'instance.first_boot',
              label: '初始化工作记忆',
              description: '实例首次启动时创建最小协作记忆文件和目录。',
              enabled: true,
            },
            {
              id: 'builtin.push-notification',
              eventPattern: 'run.completed',
              label: '完成后推送通知',
              description: '任务执行完成后发送推送提醒。',
              enabled: true,
            },
            {
              id: 'builtin.host-completion-voice',
              eventPattern: 'run.completed',
              label: '本轮完成时主机语音播报',
              description: '一次执行完成后，在宿主机本地直接执行语音播报。',
              enabled: true,
            },
            {
              id: 'builtin.branch-candidates',
              eventPattern: 'branch.suggested',
              label: '记录支线建议',
              description: '检测到适合独立处理的话题后，把建议支线写回会话记录。',
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

vm.runInNewContext(settingsUiSource, context, { filename: 'frontend-src/settings/ui.js' });
vm.runInNewContext(hooksModelSource, context, { filename: 'frontend-src/settings/hooks/model.js' });
vm.runInNewContext(hooksUiSource, context, { filename: 'frontend-src/settings/hooks/ui.js' });

hooksSettingsBtn.click();
await flushMicrotasks();
await flushMicrotasks();

assert.equal(hooksOverlay.hidden, false, 'settings button should open the shared overlay');
assert.equal(documentBody.classList.contains('hooks-overlay-open'), true, 'opening settings should tag the body state');
assert.deepEqual(fetchCalls, ['/api/settings/catalog', '/api/settings/hooks'], 'opening the hooks tab should fetch the catalog and hooks metadata exactly once');
assert.equal(settingsTabHooks.classList.contains('is-active'), true, 'hooks tab should be active by default');
assert.equal(settingsPanelHooks.hidden, false, 'hooks panel should be visible by default');
assert.equal(settingsPanelNodes.hidden, true, 'node panel should stay hidden until selected');
assert.match(hooksPanelBody.innerHTML, /按完整闭环流程查看/, 'hooks tab should explain the phase-first lifecycle grouping');
assert.match(hooksPanelBody.innerHTML, /自定义脚本 Hook 设计文件：<code>\/Users\/test\/vault\/00-🤖agent\/hooks\/custom-hooks\.json<\/code>/, 'hooks tab should expose the custom hook design file path');
assert.match(hooksPanelBody.innerHTML, /启停状态文件：<code>\/Users\/test\/vault\/00-🤖agent\/hooks\/settings\.json<\/code>/, 'hooks tab should expose the persisted hook state path');
assert.match(hooksPanelBody.innerHTML, /本地语音播报/, 'hooks tab should render the dedicated host completion voice card');
assert.match(hooksPanelBody.innerHTML, /测试完成语音播报/, 'hooks tab should expose a dedicated host voice test button');
assert.match(hooksPanelBody.innerHTML, /<div class="hooks-phase-title">启动准备<\/div>/, 'hooks tab should render the startup phase');
assert.match(hooksPanelBody.innerHTML, /<div class="hooks-phase-title">进入任务<\/div>/, 'hooks tab should render the entry phase');
assert.match(hooksPanelBody.innerHTML, /<div class="hooks-phase-title">本轮处理<\/div>/, 'hooks tab should render the execution phase');
assert.match(hooksPanelBody.innerHTML, /<div class="hooks-phase-title">收尾与分流<\/div>/, 'hooks tab should render the closeout phase');
assert.match(hooksPanelBody.innerHTML, /<div class="hooks-phase-title">支线处理与回流<\/div>/, 'hooks tab should render the branch follow-up phase');
assert.match(hooksPanelBody.innerHTML, /生命周期流程/, 'hooks tab should render the lifecycle flowchart footer');
assert.match(hooksPanelBody.innerHTML, /实例首次启动-instance\.first_boot/, 'hooks tab should render lifecycle titles as chinese label plus event id');
assert.match(hooksPanelBody.innerHTML, /执行完成-run\.completed/, 'hooks tab should render the completed run lifecycle section');
assert.match(hooksPanelBody.innerHTML, /识别支线建议-branch\.suggested/, 'hooks tab should render branch lifecycle sections');
assert.match(hooksPanelBody.innerHTML, /初始化工作记忆/, 'hooks tab should render registered hooks under their lifecycle');
assert.match(hooksPanelBody.innerHTML, /本轮完成时主机语音播报/, 'hooks tab should render run-completed hooks');
assert.match(hooksPanelBody.innerHTML, /完成后推送通知/, 'hooks tab should render run-completed hooks');
assert.match(hooksPanelBody.innerHTML, /记录支线建议/, 'hooks tab should render branch suggestion hooks');
assert.match(hooksPanelBody.innerHTML, /当前该生命周期暂无已接入 Hook。/, 'hooks tab should explicitly show empty lifecycle sections');

settingsTabNodes.click();
assert.equal(settingsTabNodes.classList.contains('is-active'), true, 'settings shell should switch to the node tab');
assert.equal(settingsPanelHooks.hidden, true, 'hooks panel should hide after switching tabs');
assert.equal(settingsPanelNodes.hidden, false, 'node panel should become visible after switching tabs');

hooksOverlayClose.click();
assert.equal(hooksOverlay.hidden, true, 'close button should hide the shared settings overlay');
assert.equal(documentBody.classList.contains('hooks-overlay-open'), false, 'close button should clear the body state');

console.log('test-chat-hooks-ui: ok');
