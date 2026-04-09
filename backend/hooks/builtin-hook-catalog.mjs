import { createHookDefinition } from './contract/index.mjs';

const BUILTIN_HOOK_DEFINITIONS = Object.freeze([
  createHookDefinition({
    id: 'builtin.first-boot-memory',
    eventPattern: 'instance.first_boot',
    label: '初始化工作记忆',
    description: '实例首次启动时创建最小协作记忆文件和目录。',
    builtIn: true,
    owner: 'hooks',
    layer: 'boot',
    sourceModule: 'backend/hooks/first-boot-memory-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.resume-completion-targets',
    eventPattern: 'instance.resume',
    label: '恢复待发送通知',
    description: '实例恢复后重新挂起尚未发送的完成通知目标。',
    builtIn: true,
    owner: 'hooks',
    layer: 'boot',
    sourceModule: 'backend/hooks/resume-completion-targets-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.graph-context-bootstrap',
    eventPattern: 'session.created',
    label: '任务创建时注入节点上下文',
    description: '创建任务后立即写入隐藏的 node/task-map 合同上下文，供首次执行读取。',
    builtIn: true,
    owner: 'hooks',
    layer: 'lifecycle',
    promptContextPolicy: 'continuity',
    sourceModule: 'backend/hooks/graph-context-bootstrap-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.push-notification',
    eventPattern: 'run.completed',
    label: '完成后推送通知',
    description: '任务执行完成后发送推送提醒。',
    builtIn: true,
    owner: 'hooks',
    layer: 'delivery',
    sourceModule: 'backend/hooks/push-notification-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.memory-writeback',
    eventPattern: 'run.completed',
    label: '完成后记忆写回',
    description: '消费 memoryCandidates 并按 Obsidian 记忆职责路由到对应长期记忆文件。',
    builtIn: true,
    owner: 'hooks',
    layer: 'closeout',
    sourceModule: 'backend/hooks/memory-writeback-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.host-completion-voice',
    eventPattern: 'run.completed',
    label: '本轮完成时主机语音播报',
    description: '一次执行完成后，在宿主机本地直接执行语音播报。',
    builtIn: true,
    owner: 'hooks',
    layer: 'delivery',
    sourceModule: 'backend/hooks/host-completion-voice-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.email-completion',
    eventPattern: 'run.completed',
    label: '完成后邮件通知',
    description: '任务执行完成后发送邮件通知，需要先配置 completionTargets。',
    builtIn: true,
    owner: 'hooks',
    layer: 'delivery',
    sourceModule: 'backend/hooks/email-completion-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.branch-candidates',
    eventPattern: 'branch.suggested',
    label: '记录支线建议',
    description: '检测到适合独立处理的话题后，把建议支线写回会话记录。',
    builtIn: true,
    owner: 'hooks',
    layer: 'lifecycle',
    taskMapPlanPolicy: 'augment-default',
    sourceModule: 'backend/hooks/branch-candidates-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.session-naming',
    eventPattern: 'run.completed',
    label: '自动命名任务',
    description: '第一次执行完成后，基于最近一轮对话生成任务标题和分组。',
    builtIn: true,
    owner: 'hooks',
    layer: 'lifecycle',
    sourceModule: 'backend/hooks/session-naming-hook.mjs',
  }),
]);

const BUILTIN_HOOK_DEFINITION_INDEX = new Map(
  BUILTIN_HOOK_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function listBuiltinHookDefinitions() {
  return BUILTIN_HOOK_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function getBuiltinHookDefinition(hookId) {
  const definition = BUILTIN_HOOK_DEFINITION_INDEX.get(String(hookId || '').trim());
  return definition ? { ...definition } : null;
}

export function getBuiltinHookTaskMapPlanPolicy(hookId) {
  return getBuiltinHookDefinition(hookId)?.taskMapPlanPolicy || 'none';
}

export function canBuiltinHookProduceTaskMapPlan(hookId) {
  return getBuiltinHookTaskMapPlanPolicy(hookId) !== 'none';
}
