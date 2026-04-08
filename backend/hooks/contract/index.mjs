import {
  HOOK_EVENT_DEFINITIONS,
  getHookEventDefinition,
  listHookEventDefinitions,
} from './events.mjs';
import {
  deriveHookScopeFromEventPattern,
  HOOK_SCOPE_DEFINITIONS,
  HOOK_SCOPE_ORDER,
  listHookScopeDefinitions,
  normalizeHookScope,
} from './scopes.mjs';
import {
  deriveHookPhaseFromEventId,
  HOOK_PHASE_DEFINITIONS,
  HOOK_PHASE_ORDER,
  listHookPhaseDefinitions,
  normalizeHookPhase,
} from './phases.mjs';

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

export const HOOK_TASK_MAP_PLAN_POLICY_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'none',
    label: '不产地图计划',
    description: '这个 hook 不应直接生成 taskMapPlan，地图继续走默认 continuity 投影。',
  }),
  Object.freeze({
    id: 'augment-default',
    label: '增强默认地图',
    description: '兼容模式：这个 hook 可以在默认 continuity 地图上补充节点和边，但 durable state 仍应是地图真值来源。',
  }),
  Object.freeze({
    id: 'replace-default',
    label: '替换默认地图',
    description: '遗留兼容模式：允许完整提供 taskMapPlan，但长期方向仍应收口到 durable state 驱动的默认投影。',
  }),
]);

export const HOOK_TASK_MAP_PLAN_POLICY_ORDER = Object.freeze(
  HOOK_TASK_MAP_PLAN_POLICY_DEFINITIONS.map((definition) => definition.id),
);

const HOOK_TASK_MAP_PLAN_POLICY_INDEX = new Map(
  HOOK_TASK_MAP_PLAN_POLICY_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export const HOOK_PROMPT_CONTEXT_POLICY_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'none',
    label: '不注入 Prompt',
    description: '这个 hook 不直接给主 Agent 注入图谱或生命周期上下文。',
  }),
  Object.freeze({
    id: 'pre-run',
    label: '执行前注入',
    description: '兼容模式：在当前 run 开始前注入补充片段。长期应优先通过 session state、handoff 或 effect 驱动，而不是让 hook 拥有 prompt 真值。',
  }),
  Object.freeze({
    id: 'continuity',
    label: '连续性注入',
    description: '兼容模式：在当前轮结束后写回隐藏连续性上下文。长期应优先收口到 event log、session state 与标准 handoff。',
  }),
  Object.freeze({
    id: 'both',
    label: '前后都注入',
    description: '遗留兼容模式：同时支持前置 prompt 注入和结束后连续性写回，默认不应作为新能力的首选落点。',
  }),
]);

export const HOOK_PROMPT_CONTEXT_POLICY_ORDER = Object.freeze(
  HOOK_PROMPT_CONTEXT_POLICY_DEFINITIONS.map((definition) => definition.id),
);

const HOOK_PROMPT_CONTEXT_POLICY_INDEX = new Map(
  HOOK_PROMPT_CONTEXT_POLICY_DEFINITIONS.map((definition) => [definition.id, definition]),
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

export function normalizeHookTaskMapPlanPolicy(value) {
  const normalized = normalizeText(value).toLowerCase();
  return HOOK_TASK_MAP_PLAN_POLICY_INDEX.has(normalized) ? normalized : 'none';
}

export function listHookTaskMapPlanPolicyDefinitions() {
  return HOOK_TASK_MAP_PLAN_POLICY_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function normalizeHookPromptContextPolicy(value) {
  const normalized = normalizeText(value).toLowerCase();
  return HOOK_PROMPT_CONTEXT_POLICY_INDEX.has(normalized) ? normalized : 'none';
}

export function listHookPromptContextPolicyDefinitions() {
  return HOOK_PROMPT_CONTEXT_POLICY_DEFINITIONS.map((definition) => ({ ...definition }));
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
  const taskMapPlanPolicy = normalizeHookTaskMapPlanPolicy(definition.taskMapPlanPolicy);
  const promptContextPolicy = normalizeHookPromptContextPolicy(definition.promptContextPolicy);
  const legacyCompatibilitySurfaces = Object.freeze([
    ...(taskMapPlanPolicy !== 'none' ? ['task-map-plan'] : []),
    ...(promptContextPolicy !== 'none' ? ['prompt-context'] : []),
  ]);
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
    taskMapPlanPolicy,
    producesTaskMapPlan: taskMapPlanPolicy !== 'none',
    promptContextPolicy,
    producesPromptContext: promptContextPolicy !== 'none',
    usesLegacyCompatibilitySurface: legacyCompatibilitySurfaces.length > 0,
    legacyCompatibilitySurfaces,
    sourceModule: normalizeText(definition.sourceModule),
    enabledByDefault: definition.enabledByDefault !== false,
  });
}
