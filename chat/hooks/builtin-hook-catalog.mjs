import { createHookDefinition } from './hook-contract.mjs';

const BUILTIN_HOOK_DEFINITIONS = Object.freeze([
  createHookDefinition({
    id: 'builtin.first-boot-memory',
    eventPattern: 'instance.first_boot',
    label: '初始化工作记忆',
    description: '实例首次启动时创建最小协作记忆文件和目录。',
    builtIn: true,
    owner: 'hooks',
    layer: 'boot',
    sourceModule: 'chat/hooks/first-boot-memory-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.resume-completion-targets',
    eventPattern: 'instance.resume',
    label: '恢复待发送通知',
    description: '实例恢复后重新挂起尚未发送的完成通知目标。',
    builtIn: true,
    owner: 'hooks',
    layer: 'boot',
    sourceModule: 'chat/hooks/resume-completion-targets-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.push-notification',
    eventPattern: 'run.completed',
    label: '完成后推送通知',
    description: '任务执行完成后发送推送提醒。',
    builtIn: true,
    owner: 'hooks',
    layer: 'delivery',
    sourceModule: 'chat/hooks/push-notification-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.email-completion',
    eventPattern: 'run.completed',
    label: '完成后邮件通知',
    description: '任务执行完成后发送邮件通知，需要先配置 completionTargets。',
    builtIn: true,
    owner: 'hooks',
    layer: 'delivery',
    sourceModule: 'chat/hooks/email-completion-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.branch-candidates',
    eventPattern: 'branch.suggested',
    label: '记录支线建议',
    description: '检测到适合独立处理的话题后，把建议支线写回会话记录。',
    builtIn: true,
    owner: 'hooks',
    layer: 'lifecycle',
    sourceModule: 'chat/hooks/branch-candidates-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.session-naming',
    eventPattern: 'run.completed',
    label: '自动命名任务',
    description: '第一次执行完成后，基于最近一轮对话生成任务标题和分组。',
    builtIn: true,
    owner: 'hooks',
    layer: 'lifecycle',
    sourceModule: 'chat/hooks/session-naming-hook.mjs',
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
