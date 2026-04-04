import { registerBuiltinHooks } from './hooks/runtime/register-builtins.mjs';
import { registerCustomHooks } from './hooks/runtime/register-custom-hooks.mjs';

registerBuiltinHooks();
await registerCustomHooks();

export {
  applyHookEnabledOverrides,
  emit,
  getHookEnabledOverrides,
  HOOK_EVENT_DEFINITIONS,
  HOOK_EVENTS,
  listHookEventDefinitions,
  listHooks,
  registerHook,
  setHookEnabled,
} from './hooks/runtime/registry.mjs';
