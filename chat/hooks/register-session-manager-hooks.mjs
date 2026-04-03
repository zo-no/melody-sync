import { registerHook } from '../session-hook-registry.mjs';
import { getBuiltinHookDefinition } from './builtin-hook-catalog.mjs';
import { createBranchCandidatesHook } from './branch-candidates-hook.mjs';
import { createResumeCompletionTargetsHook } from './resume-completion-targets-hook.mjs';
import { createSessionNamingHook } from './session-naming-hook.mjs';

let registered = false;

function registerCatalogHook(hookId, hook) {
  const definition = getBuiltinHookDefinition(hookId);
  if (!definition) {
    throw new Error(`Unknown built-in hook definition: ${hookId}`);
  }
  registerHook(definition.eventPattern, hook, definition);
}

export function registerSessionManagerBuiltinHooks(deps = {}) {
  if (registered) return;
  registered = true;

  registerCatalogHook(
    'builtin.resume-completion-targets',
    createResumeCompletionTargetsHook({
      resumePendingCompletionTargets: deps.resumePendingCompletionTargets,
    }),
  );
  registerCatalogHook(
    'builtin.branch-candidates',
    createBranchCandidatesHook({ appendEvents: deps.appendEvents }),
  );
  registerCatalogHook(
    'builtin.session-naming',
    createSessionNamingHook({
      isSessionAutoRenamePending: deps.isSessionAutoRenamePending,
      triggerAutomaticSessionLabeling: deps.triggerAutomaticSessionLabeling,
    }),
  );
}
