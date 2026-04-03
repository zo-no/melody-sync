import { registerBuiltinHooks } from './hooks/runtime/register-builtins.mjs';

registerBuiltinHooks();

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
