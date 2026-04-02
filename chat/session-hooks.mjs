import { registerBuiltinHooks } from './hooks/register-builtin-hooks.mjs';

registerBuiltinHooks();

export {
  HOOK_EVENTS,
  HOOK_EVENT_DEFINITIONS,
  emit,
  listHookEventDefinitions,
  listHooks,
  registerHook,
  setHookEnabled,
} from './session-hook-registry.mjs';
