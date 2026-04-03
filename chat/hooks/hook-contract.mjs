import {
  HOOK_EVENT_DEFINITIONS,
  getHookEventDefinition,
  listHookEventDefinitions,
} from './contract/events.mjs';
import {
  deriveHookScopeFromEventPattern,
  HOOK_SCOPE_DEFINITIONS,
  HOOK_SCOPE_ORDER,
  listHookScopeDefinitions,
  normalizeHookScope,
} from './contract/scopes.mjs';
import {
  deriveHookPhaseFromEventId,
  HOOK_PHASE_DEFINITIONS,
  HOOK_PHASE_ORDER,
  listHookPhaseDefinitions,
  normalizeHookPhase,
} from './contract/phases.mjs';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export {
  deriveHookScopeFromEventPattern,
  HOOK_EVENT_DEFINITIONS,
  HOOK_PHASE_DEFINITIONS,
  HOOK_PHASE_ORDER,
  HOOK_SCOPE_DEFINITIONS,
  HOOK_SCOPE_ORDER,
  listHookEventDefinitions,
  listHookPhaseDefinitions,
  listHookScopeDefinitions,
  normalizeHookPhase,
  normalizeHookScope,
};

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

export function createHookDefinition(definition = {}) {
  const id = normalizeText(definition.id);
  const eventPattern = normalizeText(definition.eventPattern);
  if (!id) {
    throw new Error('Hook definition requires id');
  }
  if (!eventPattern) {
    throw new Error(`Hook definition ${id} requires eventPattern`);
  }
  const eventDefinition = getHookEventDefinition(eventPattern);
  const scope = normalizeHookScope(
    definition.scope
    || eventDefinition?.scope
    || deriveHookScopeFromEventPattern(eventPattern),
  );
  const phase = normalizeHookPhase(
    definition.phase
    || eventDefinition?.phase
    || deriveHookPhaseFromEventId(eventPattern),
  );
  return Object.freeze({
    id,
    eventPattern,
    label: normalizeText(definition.label) || id,
    description: normalizeText(definition.description),
    builtIn: definition.builtIn === true,
    owner: normalizeText(definition.owner) || 'hooks',
    layer: normalizeHookLayer(definition.layer),
    scope,
    phase,
    sourceModule: normalizeText(definition.sourceModule),
  });
}
