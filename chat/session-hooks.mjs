import { registerBuiltinHooks } from './hooks/register-builtin-hooks.mjs';

registerBuiltinHooks();

export {
  applyHookEnabledOverrides,
  HOOK_EVENTS,
  HOOK_EVENT_DEFINITIONS,
  emit,
  getHookEnabledOverrides,
  listHookEventDefinitions,
  listHooks,
  registerHook,
  setHookEnabled,
} from './session-hook-registry.mjs';
