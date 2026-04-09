import { registerHook } from './registry.mjs';
import { getBuiltinHookDefinition } from '../builtin-hook-catalog.mjs';
import { firstBootMemoryHook } from '../first-boot-memory-hook.mjs';
import { pushNotificationHook } from '../push-notification-hook.mjs';
import { emailCompletionHook } from '../email-completion-hook.mjs';
import { hostCompletionVoiceHook } from '../host-completion-voice-hook.mjs';
import { memoryWritebackHook } from '../memory-writeback-hook.mjs';

let builtinHooksRegistered = false;

function registerCatalogHook(hookId, hook) {
  const definition = getBuiltinHookDefinition(hookId);
  if (!definition) {
    throw new Error(`Unknown built-in hook definition: ${hookId}`);
  }
  registerHook(definition.eventPattern, hook, {
    ...definition,
    enabled: definition.enabledByDefault !== false,
  });
}

export function registerBuiltinHooks() {
  if (builtinHooksRegistered) return;
  builtinHooksRegistered = true;
  registerCatalogHook('builtin.first-boot-memory', firstBootMemoryHook);
  registerCatalogHook('builtin.push-notification', pushNotificationHook);
  registerCatalogHook('builtin.memory-writeback', memoryWritebackHook);
  registerCatalogHook('builtin.host-completion-voice', hostCompletionVoiceHook);
  registerCatalogHook('builtin.email-completion', emailCompletionHook);
}
