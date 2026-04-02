import { registerHook } from '../session-hook-registry.mjs';
import { getBuiltinHookDefinition } from './builtin-hook-catalog.mjs';
import { pushNotificationHook } from './push-notification-hook.mjs';
import { emailCompletionHook } from './email-completion-hook.mjs';
import { workbenchSyncHook } from './workbench-sync-hook.mjs';

let builtinHooksRegistered = false;

function registerCatalogHook(hookId, hook) {
  const definition = getBuiltinHookDefinition(hookId);
  if (!definition) {
    throw new Error(`Unknown built-in hook definition: ${hookId}`);
  }
  registerHook(definition.eventPattern, hook, definition);
}

export function registerBuiltinHooks() {
  if (builtinHooksRegistered) return;
  builtinHooksRegistered = true;

  registerCatalogHook('builtin.push-notification', pushNotificationHook);
  registerCatalogHook('builtin.email-completion', emailCompletionHook);
  registerCatalogHook('builtin.workbench-sync', workbenchSyncHook);
  registerCatalogHook('builtin.workbench-sync-on-fail', workbenchSyncHook);
}
