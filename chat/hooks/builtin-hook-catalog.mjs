const BUILTIN_HOOK_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'builtin.push-notification',
    eventPattern: 'run.completed',
    label: '推送通知',
    description: 'Run 完成后发送推送通知',
    builtIn: true,
    owner: 'hooks',
    sourceModule: 'chat/hooks/push-notification-hook.mjs',
  }),
  Object.freeze({
    id: 'builtin.email-completion',
    eventPattern: 'run.completed',
    label: 'Email 通知',
    description: 'Run 完成后发送 email（需配置 completionTargets）',
    builtIn: true,
    owner: 'hooks',
    sourceModule: 'chat/hooks/email-completion-hook.mjs',
  }),
  Object.freeze({
    id: 'builtin.workbench-sync',
    eventPattern: 'run.completed',
    label: '地图同步',
    description: 'Run 完成后将 taskCard 同步到任务地图',
    builtIn: true,
    owner: 'hooks',
    sourceModule: 'chat/hooks/workbench-sync-hook.mjs',
  }),
  Object.freeze({
    id: 'builtin.workbench-sync-on-fail',
    eventPattern: 'run.failed',
    label: '地图同步（失败时）',
    description: 'Run 失败/取消时也同步地图状态',
    builtIn: true,
    owner: 'hooks',
    sourceModule: 'chat/hooks/workbench-sync-hook.mjs',
  }),
  Object.freeze({
    id: 'builtin.branch-candidates',
    eventPattern: 'run.completed',
    label: '支线任务推荐',
    description: 'Run 完成后将 AI 推荐的支线写入会话，显示在地图上',
    builtIn: true,
    owner: 'session-manager',
    sourceModule: 'chat/session-manager.mjs',
  }),
  Object.freeze({
    id: 'builtin.session-naming',
    eventPattern: 'run.completed',
    label: 'Session 自动命名',
    description: '第一次 Run 完成后基于最后一轮对话生成标题和分组',
    builtIn: true,
    owner: 'session-manager',
    sourceModule: 'chat/session-manager.mjs',
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
