import { deriveHookScopeFromEventPattern } from './scopes.mjs';
import { deriveHookPhaseFromEventId } from './phases.mjs';

function createEventDefinition(definition = {}) {
  const id = String(definition.id || '').trim();
  if (!id) {
    throw new Error('Hook event definition requires id');
  }
  return Object.freeze({
    id,
    label: String(definition.label || id).trim() || id,
    description: String(definition.description || '').trim(),
    scope: deriveHookScopeFromEventPattern(id),
    phase: deriveHookPhaseFromEventId(id),
  });
}

export const HOOK_EVENT_DEFINITIONS = Object.freeze([
  createEventDefinition({
    id: 'instance.first_boot',
    label: '实例首次启动',
    description: '当前实例第一次启动且本地 memory/bootstrap 种子尚未初始化时。',
  }),
  createEventDefinition({
    id: 'instance.startup',
    label: '实例启动完成',
    description: '服务启动完成、基础目录准备完毕之后。',
  }),
  createEventDefinition({
    id: 'instance.resume',
    label: '实例恢复完成',
    description: '服务完成启动期恢复动作之后。',
  }),
  createEventDefinition({
    id: 'session.created',
    label: '新建任务',
    description: '新任务完成初始化并写入元数据之后。',
  }),
  createEventDefinition({
    id: 'session.first_user_message',
    label: '首次发送消息',
    description: '任务第一条真实用户消息进入历史之后。',
  }),
  createEventDefinition({
    id: 'session.waiting_user',
    label: '需要用户接手',
    description: '任务进入需要用户确认、选择、补资料或手动验证的状态之后。',
  }),
  createEventDefinition({
    id: 'session.completed',
    label: '任务完成',
    description: '任务 workflowState 从非 done 变为 done 之后。',
  }),
  createEventDefinition({
    id: 'run.started',
    label: '开始执行',
    description: '新的一次执行建立并进入处理流程之后。',
  }),
  createEventDefinition({
    id: 'run.completed',
    label: '执行完成',
    description: '一次执行成功完成并且结果已经回写之后。',
  }),
  createEventDefinition({
    id: 'run.failed',
    label: '执行失败或取消',
    description: '一次执行失败、终止或取消之后。',
  }),
  createEventDefinition({
    id: 'branch.suggested',
    label: '识别支线建议',
    description: '检测到适合独立处理的话题，并产出候选支线事件之后。',
  }),
  createEventDefinition({
    id: 'branch.opened',
    label: '开启支线',
    description: '新的支线任务和 branch context 已持久化并进入处理状态之后。',
  }),
  createEventDefinition({
    id: 'branch.merged',
    label: '支线合并回主线',
    description: '支线结果已经回流主线并写入合并记录之后。',
  }),
]);

export const HOOK_EVENTS = Object.freeze(
  HOOK_EVENT_DEFINITIONS.map((definition) => definition.id),
);

const HOOK_EVENT_INDEX = new Map(
  HOOK_EVENT_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function listHookEventDefinitions() {
  return HOOK_EVENT_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function getHookEventDefinition(eventId) {
  const definition = HOOK_EVENT_INDEX.get(String(eventId || '').trim());
  return definition ? { ...definition } : null;
}
