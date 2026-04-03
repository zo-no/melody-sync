import { registerHook } from './registry.mjs';
import { getBuiltinHookDefinition } from '../builtin-hook-catalog.mjs';
import { createBranchCandidatesHook } from '../branch-candidates-hook.mjs';
import { createGraphContextBootstrapHook } from '../graph-context-bootstrap-hook.mjs';
import { createResumeCompletionTargetsHook } from '../resume-completion-targets-hook.mjs';
import { createSessionNamingHook } from '../session-naming-hook.mjs';
import { syncBranchCandidateTaskMapPlan } from '../../workbench/task-map-plan-producers.mjs';
import { appendGraphBootstrapPromptContext } from '../../workbench/graph-prompt-context.mjs';

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
  const listSessions = typeof deps.listSessions === 'function'
    ? deps.listSessions
    : (async () => []);
  const nowIso = typeof deps.nowIso === 'function'
    ? deps.nowIso
    : (() => new Date().toISOString());

  registerCatalogHook(
    'builtin.resume-completion-targets',
    createResumeCompletionTargetsHook({
      resumePendingCompletionTargets: deps.resumePendingCompletionTargets,
    }),
  );
  registerCatalogHook(
    'builtin.graph-context-bootstrap',
    createGraphContextBootstrapHook({
      appendGraphPromptContext: async ({ sessionId, session }) => appendGraphBootstrapPromptContext({
        sessionId,
        session,
        appendEvents: deps.appendEvents,
        loadHistory: deps.loadHistory,
      }),
    }),
  );
  registerCatalogHook(
    'builtin.branch-candidates',
    createBranchCandidatesHook({
      appendEvents: deps.appendEvents,
      syncBranchCandidateTaskMapPlan: async (context = {}) => {
        const sessions = await listSessions({ includeArchived: true });
        return syncBranchCandidateTaskMapPlan({
          session: context.session,
          sessions,
          nowIso,
          updateSessionTaskCard: deps.updateSessionTaskCard,
        });
      },
    }),
  );
  registerCatalogHook(
    'builtin.session-naming',
    createSessionNamingHook({
      isSessionAutoRenamePending: deps.isSessionAutoRenamePending,
      triggerAutomaticSessionLabeling: deps.triggerAutomaticSessionLabeling,
    }),
  );
}
