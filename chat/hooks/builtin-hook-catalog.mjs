import { createHookDefinition } from './hook-contract.mjs';

const BUILTIN_HOOK_DEFINITIONS = Object.freeze([
  createHookDefinition({
    id: 'builtin.first-boot-memory',
    eventPattern: 'instance.first_boot',
    label: '首次启动记忆初始化',
    description: '实例首次启动时创建最小 memory/bootstrap 种子文件。',
    builtIn: true,
    owner: 'hooks',
    layer: 'boot',
    sourceModule: 'chat/hooks/first-boot-memory-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.resume-completion-targets',
    eventPattern: 'instance.resume',
    label: '恢复完成通知目标',
    description: '实例启动恢复后重新挂起已完成 run 的 completion targets。',
    builtIn: true,
    owner: 'hooks',
    layer: 'boot',
    sourceModule: 'chat/hooks/resume-completion-targets-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.push-notification',
    eventPattern: 'run.completed',
    label: '推送通知',
    description: 'Run 完成后发送推送通知',
    builtIn: true,
    owner: 'hooks',
    layer: 'delivery',
    sourceModule: 'chat/hooks/push-notification-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.email-completion',
    eventPattern: 'run.completed',
    label: 'Email 通知',
    description: 'Run 完成后发送 email（需配置 completionTargets）',
    builtIn: true,
    owner: 'hooks',
    layer: 'delivery',
    sourceModule: 'chat/hooks/email-completion-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.branch-candidates',
    eventPattern: 'branch.suggested',
    label: '支线任务推荐',
    description: '检测到需要单独处理的话题后，将候选支线写入会话生命周期事件。',
    builtIn: true,
    owner: 'hooks',
    layer: 'lifecycle',
    sourceModule: 'chat/hooks/branch-candidates-hook.mjs',
  }),
  createHookDefinition({
    id: 'builtin.session-naming',
    eventPattern: 'run.completed',
    label: 'Session 自动命名',
    description: '第一次 Run 完成后基于最后一轮对话生成标题和分组',
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
