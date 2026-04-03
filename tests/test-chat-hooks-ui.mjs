#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const hooksModelSource = readFileSync(join(repoRoot, 'static/chat/settings/hooks/model.js'), 'utf8');
const hooksUiSource = readFileSync(join(repoRoot, 'static/chat/settings/hooks/ui.js'), 'utf8');

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
          scopeDefinitions: [
            { id: 'instance', label: '实例', description: '实例启动、首次初始化和恢复相关的生命周期工作。' },
            { id: 'session', label: '任务', description: '任务建立和首次进入真实对话相关的生命周期工作。' },
            { id: 'run', label: '单次执行', description: '单次执行的启动、完成和失败相关的生命周期工作。' },
            { id: 'branch', label: '支线', description: '支线建议、开启和合并回主线相关的生命周期工作。' },
          ],
          scopeOrder: ['instance', 'session', 'run', 'branch'],
          phaseDefinitions: [
            { id: 'startup', label: '启动准备', description: '实例启动、首次初始化和恢复相关的闭环起点。' },
            { id: 'entry', label: '进入任务', description: '任务建立并首次进入真实对话的阶段。' },
            { id: 'execution', label: '本轮处理', description: '任务进入本轮处理并持续推进的阶段。' },
            { id: 'closeout', label: '收尾与分流', description: '执行完成后的命名、通知、失败回执和支线建议。' },
            { id: 'branch_followup', label: '支线处理与回流', description: '支线被打开后继续推进，并在合适时回流主线。' },
          ],
          phaseOrder: ['startup', 'entry', 'execution', 'closeout', 'branch_followup'],
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
            { id: 'instance.first_boot', scope: 'instance', phase: 'startup', label: '实例首次启动', description: '当前实例第一次启动且本地 memory/bootstrap 种子尚未初始化时。' },
            { id: 'instance.startup', scope: 'instance', phase: 'startup', label: '实例启动完成', description: '服务启动完成、基础目录准备完毕之后。' },
            { id: 'instance.resume', scope: 'instance', phase: 'startup', label: '实例恢复完成', description: '服务完成启动期恢复动作之后。' },
            { id: 'session.created', scope: 'session', phase: 'entry', label: '新建任务', description: '新任务完成初始化并写入元数据之后。' },
            { id: 'session.first_user_message', scope: 'session', phase: 'entry', label: '首次发送消息', description: '任务第一条真实用户消息进入历史之后。' },
            { id: 'run.started', scope: 'run', phase: 'execution', label: '开始执行', description: '新的一次执行建立并进入处理流程之后。' },
            { id: 'run.completed', scope: 'run', phase: 'closeout', label: '执行完成', description: '一次执行成功完成并且结果已经回写之后。' },
            { id: 'run.failed', scope: 'run', phase: 'closeout', label: '执行失败或取消', description: '一次执行失败、终止或取消之后。' },
            { id: 'branch.suggested', scope: 'branch', phase: 'closeout', label: '识别支线建议', description: '检测到适合独立处理的话题，并产出候选支线事件之后。' },
            { id: 'branch.opened', scope: 'branch', phase: 'branch_followup', label: '开启支线', description: '新的支线任务和 branch context 已持久化并进入处理状态之后。' },
            { id: 'branch.merged', scope: 'branch', phase: 'branch_followup', label: '支线合并回主线', description: '支线结果已经回流主线并写入合并记录之后。' },
          ],
          hooks: [
            {
              id: 'builtin.first-boot-memory',
              eventPattern: 'instance.first_boot',
              label: '初始化工作记忆',
              description: '实例首次启动时创建最小协作记忆文件和目录。',
              builtIn: true,
              layer: 'boot',
              sourceModule: 'chat/hooks/first-boot-memory-hook.mjs',
              enabled: true,
            },
            {
              id: 'builtin.push-notification',
              eventPattern: 'run.completed',
              label: '完成后推送通知',
              description: '任务执行完成后发送推送提醒。',
              builtIn: true,
              layer: 'delivery',
              sourceModule: 'chat/hooks/push-notification-hook.mjs',
              enabled: true,
            },
            {
              id: 'builtin.branch-candidates',
              eventPattern: 'branch.suggested',
              label: '记录支线建议',
              description: '检测到适合独立处理的话题后，把建议支线写回会话记录。',
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

vm.runInNewContext(hooksModelSource, context, { filename: 'static/chat/settings/hooks/model.js' });
vm.runInNewContext(hooksUiSource, context, { filename: 'static/chat/settings/hooks/ui.js' });

hooksSettingsBtn.click();
await flushMicrotasks();
await flushMicrotasks();

assert.equal(hooksOverlay.hidden, false, 'hooks settings click should open the overlay');
assert.equal(documentBody.classList.contains('hooks-overlay-open'), true, 'opening hooks settings should tag the body state');
assert.deepEqual(fetchCalls, ['/api/hooks'], 'opening hooks settings should fetch the hooks metadata exactly once');
assert.match(hooksPanelBody.innerHTML, /按完整闭环流程查看/, 'hooks settings should explain the phase-first lifecycle grouping');
assert.match(hooksPanelBody.innerHTML, /<div class="hooks-phase-title">启动准备<\/div>/, 'hooks settings should render the startup phase');
assert.match(hooksPanelBody.innerHTML, /<div class="hooks-phase-title">进入任务<\/div>/, 'hooks settings should render the entry phase');
assert.match(hooksPanelBody.innerHTML, /<div class="hooks-phase-title">本轮处理<\/div>/, 'hooks settings should render the execution phase');
assert.match(hooksPanelBody.innerHTML, /<div class="hooks-phase-title">收尾与分流<\/div>/, 'hooks settings should render the closeout phase');
assert.match(hooksPanelBody.innerHTML, /<div class="hooks-phase-title">支线处理与回流<\/div>/, 'hooks settings should render the branch follow-up phase');
assert.match(hooksPanelBody.innerHTML, /生命周期流程/, 'hooks settings should render the lifecycle flowchart footer');
assert.match(hooksPanelBody.innerHTML, /实例启动完成/, 'lifecycle flowchart should include startup events');
assert.match(hooksPanelBody.innerHTML, /识别支线建议/, 'lifecycle flowchart should include closeout branch-suggestion events');
assert.match(hooksPanelBody.innerHTML, /支线合并回主线/, 'lifecycle flowchart should include branch follow-up events');
assert.match(hooksPanelBody.innerHTML, /实例首次启动-instance\.first_boot/, 'hooks settings should render lifecycle titles as chinese label plus event id');
assert.match(hooksPanelBody.innerHTML, /实例启动完成-instance\.startup/, 'hooks settings should keep lifecycle sections even when no hooks are registered');
assert.match(hooksPanelBody.innerHTML, /执行完成-run\.completed/, 'hooks settings should render the completed run lifecycle section');
assert.match(hooksPanelBody.innerHTML, /识别支线建议-branch\.suggested/, 'hooks settings should render branch lifecycle sections');
assert.match(hooksPanelBody.innerHTML, /支线合并回主线-branch\.merged/, 'hooks settings should render empty branch merge lifecycle sections too');
assert.match(hooksPanelBody.innerHTML, /初始化工作记忆/, 'hooks settings should render registered hooks under their lifecycle');
assert.match(hooksPanelBody.innerHTML, /完成后推送通知/, 'hooks settings should render delivery hooks under run.completed');
assert.match(hooksPanelBody.innerHTML, /记录支线建议/, 'hooks settings should render branch suggestion hooks');
assert.match(hooksPanelBody.innerHTML, /首次发送消息-session\.first_user_message/, 'hooks settings should show lifecycle titles even when there are no hooks yet');
assert.match(hooksPanelBody.innerHTML, /当前该生命周期暂无已接入 Hook。/, 'hooks settings should explicitly show empty lifecycle sections');
assert.match(hooksPanelBody.innerHTML, /未接入/, 'hooks settings should show a restrained empty-state badge for uncovered lifecycle nodes');
assert.match(hooksPanelBody.innerHTML, /已接入 1 项/, 'hooks settings should render compact Chinese coverage counts');
assert.doesNotMatch(hooksPanelBody.innerHTML, /<div class="hooks-summary-title">/, 'hooks settings should not repeat a summary title above the panel explanation');
assert.doesNotMatch(hooksPanelBody.innerHTML, /Hooks 是生命周期自动化，不是项目真值/, 'hooks settings should no longer render the old architecture summary');
assert.doesNotMatch(hooksPanelBody.innerHTML, /\/tmp\/melody-sync\/hooks\.json/, 'hooks settings should no longer surface storage-path details');
assert.doesNotMatch(hooksPanelBody.innerHTML, /Boot Hooks|Delivery Hooks/, 'hooks settings should no longer group the UI by layer');
assert.doesNotMatch(hooksPanelBody.innerHTML, /待接入生命周期/, 'hooks settings should no longer split uncovered events into a separate data section');
assert.doesNotMatch(hooksPanelBody.innerHTML, /chat\/hooks\/first-boot-memory-hook\.mjs/, 'hooks settings should not show source module paths in the minimal panel');
assert.doesNotMatch(hooksPanelBody.innerHTML, /Session Stream|Task List Rows|task_list_order/, 'hooks settings should not show UI surface or reserved-truth metadata in the minimal panel');

hooksOverlayClose.click();
assert.equal(hooksOverlay.hidden, true, 'close button should hide the hooks overlay');
assert.equal(documentBody.classList.contains('hooks-overlay-open'), false, 'close button should clear the body state');

console.log('test-chat-hooks-ui: ok');
