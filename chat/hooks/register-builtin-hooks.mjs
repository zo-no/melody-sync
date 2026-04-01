import { registerHook } from '../session-hook-registry.mjs';
import { pushNotificationHook } from './push-notification-hook.mjs';
import { emailCompletionHook } from './email-completion-hook.mjs';
import { workbenchSyncHook } from './workbench-sync-hook.mjs';

let builtinHooksRegistered = false;

export function registerBuiltinHooks() {
  if (builtinHooksRegistered) return;
  builtinHooksRegistered = true;

  registerHook('run.completed', pushNotificationHook, {
    id: 'builtin.push-notification',
    label: '推送通知',
    description: 'Run 完成后发送推送通知',
    builtIn: true,
  });

  registerHook('run.completed', emailCompletionHook, {
    id: 'builtin.email-completion',
    label: 'Email 通知',
    description: 'Run 完成后发送 email（需配置 completionTargets）',
    builtIn: true,
  });

  registerHook('run.completed', workbenchSyncHook, {
    id: 'builtin.workbench-sync',
    label: '地图同步',
    description: 'Run 完成后将 taskCard 同步到任务地图',
    builtIn: true,
  });

  registerHook('run.failed', workbenchSyncHook, {
    id: 'builtin.workbench-sync-on-fail',
    label: '地图同步（失败时）',
    description: 'Run 失败/取消时也同步地图状态',
    builtIn: true,
  });
}
