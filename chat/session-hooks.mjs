import { registerBuiltinHooks } from './hooks/register-builtin-hooks.mjs';

registerBuiltinHooks();

export {
  HOOK_EVENTS,
  emit,
  listHooks,
  registerHook,
  setHookEnabled,
} from './session-hook-registry.mjs';
