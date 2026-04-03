function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export const HOOK_LAYER_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'boot',
    label: 'Boot Hooks',
    description: '实例首次启动、启动恢复、运行环境初始化相关的 hooks。',
  }),
  Object.freeze({
    id: 'lifecycle',
    label: 'Lifecycle Hooks',
    description: '会话、Run、支线和完成闭环相关的生命周期派生处理。',
  }),
  Object.freeze({
    id: 'delivery',
    label: 'Delivery Hooks',
    description: '对外通知、邮件、回调等外部交付副作用。',
  }),
  Object.freeze({
    id: 'other',
    label: 'Other Hooks',
    description: '未归入标准生命周期层的 hooks。',
  }),
]);

export const HOOK_LAYER_ORDER = Object.freeze(
  HOOK_LAYER_DEFINITIONS.map((definition) => definition.id),
);

const HOOK_LAYER_INDEX = new Map(
  HOOK_LAYER_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export const HOOK_UI_TARGET_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'session_stream',
    label: 'Session Stream',
    description: '在会话流中插入生命周期事件、提示卡和完成收据。',
  }),
  Object.freeze({
    id: 'task_status_strip',
    label: 'Task Status Strip',
    description: '更新顶部轻状态条中的提示性状态信息。',
  }),
  Object.freeze({
    id: 'task_action_panel',
    label: 'Task Action Panel',
    description: '更新输入区附近的行动建议和下一步提示。',
  }),
  Object.freeze({
    id: 'task_map',
    label: 'Task Map Surface',
    description: '给任务地图添加提示性覆盖信息、入口和状态提示，但不拥有 node 真值。',
  }),
  Object.freeze({
    id: 'task_list_rows',
    label: 'Task List Rows',
    description: '更新 GTD 任务列表中的任务名、分组标签和辅助文案，但不拥有顺序真值。',
  }),
  Object.freeze({
    id: 'task_list_badges',
    label: 'Task List Badges',
    description: '更新任务列表中的徽标、状态点和轻量提示。',
  }),
  Object.freeze({
    id: 'composer_assist',
    label: 'Composer Assist',
    description: '更新输入区附近的建议问句、快捷动作和补充上下文提示。',
  }),
  Object.freeze({
    id: 'workspace_notices',
    label: 'Workspace Notices',
    description: '在工作区插入阶段性提示、完成收据和全局 notice。',
  }),
  Object.freeze({
    id: 'settings_panels',
    label: 'Settings Panels',
    description: '在设置面板中展示 hook 能力、状态、解释和调试信息。',
  }),
]);

export const HOOK_UI_RESERVED_TRUTHS = Object.freeze([
  Object.freeze({
    id: 'task_list_order',
    description: '任务列表顺序由 session-list-order contract 独立管理，hook 不应直接拥有排序真值。',
  }),
  Object.freeze({
    id: 'task_map_nodes',
    description: '地图 node 投影由 durable state 驱动，hook 不应成为 node 真值来源。',
  }),
]);

export const HOOK_EVENT_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'instance.first_boot',
    label: '实例首次启动',
    description: '当前实例第一次启动且本地 memory/bootstrap 种子尚未初始化时。',
  }),
  Object.freeze({
    id: 'instance.startup',
    label: '实例启动后',
    description: '服务启动完成、基础目录准备完毕之后。',
  }),
  Object.freeze({
    id: 'instance.resume',
    label: '实例恢复后',
    description: '服务完成启动期恢复动作之后。',
  }),
  Object.freeze({
    id: 'session.created',
    label: 'Session 创建后',
    description: '新 session 完成初始化并写入 metadata 之后。',
  }),
  Object.freeze({
    id: 'session.first_user_message',
    label: '首条用户消息记录后',
    description: 'session 第一条真实用户消息进入历史之后。',
  }),
  Object.freeze({
    id: 'run.started',
    label: 'Run 启动后',
    description: '新的 detached run 建立并进入执行流程之后。',
  }),
  Object.freeze({
    id: 'run.completed',
    label: 'Run 完成后',
    description: 'Run 成功完成并且结果已经回写之后。',
  }),
  Object.freeze({
    id: 'run.failed',
    label: 'Run 失败/取消后',
    description: 'Run 失败、终止或取消之后。',
  }),
  Object.freeze({
    id: 'branch.suggested',
    label: '建议单独处理话题后',
    description: '检测到高置信上下文隔离话题，并产出候选支线生命周期事件之后。',
  }),
  Object.freeze({
    id: 'branch.opened',
    label: '支线开启后',
    description: '新的支线 session/branch context 已持久化并进入处理状态之后。',
  }),
  Object.freeze({
    id: 'branch.merged',
    label: '支线带回主线后',
    description: '支线结果已经回流到主线并写入 merge note 之后。',
  }),
]);

const HOOK_EVENT_INDEX = new Map(
  HOOK_EVENT_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function normalizeHookLayer(value) {
  const normalized = normalizeText(value).toLowerCase();
  return HOOK_LAYER_INDEX.has(normalized) ? normalized : 'other';
}

export function listHookLayerDefinitions() {
  return HOOK_LAYER_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function listHookUiTargetDefinitions() {
  return HOOK_UI_TARGET_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function listHookUiReservedTruths() {
  return HOOK_UI_RESERVED_TRUTHS.map((definition) => ({ ...definition }));
}

export function listHookEventDefinitions() {
  return HOOK_EVENT_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function getHookEventDefinition(eventId) {
  const definition = HOOK_EVENT_INDEX.get(normalizeText(eventId));
  return definition ? { ...definition } : null;
}

export function createHookDefinition(definition = {}) {
  const id = normalizeText(definition.id);
  const eventPattern = normalizeText(definition.eventPattern);
  if (!id) {
    throw new Error('Hook definition requires id');
  }
  if (!eventPattern) {
    throw new Error(`Hook definition ${id} requires eventPattern`);
  }
  return Object.freeze({
    id,
    eventPattern,
    label: normalizeText(definition.label) || id,
    description: normalizeText(definition.description),
    builtIn: definition.builtIn === true,
    owner: normalizeText(definition.owner) || 'hooks',
    layer: normalizeHookLayer(definition.layer),
    sourceModule: normalizeText(definition.sourceModule),
  });
}
