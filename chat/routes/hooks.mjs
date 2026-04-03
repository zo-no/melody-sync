import { readBody } from '../../lib/utils.mjs';
import { CUSTOM_HOOKS_FILE, HOOKS_FILE } from '../../lib/config.mjs';
import { persistHookEnabledState } from '../hooks/runtime/settings-store.mjs';
import {
  HOOK_LAYER_ORDER,
  HOOK_PHASE_ORDER,
  HOOK_PROMPT_CONTEXT_POLICY_ORDER,
  HOOK_SCOPE_ORDER,
  HOOK_TASK_MAP_PLAN_POLICY_ORDER,
  listHookLayerDefinitions,
  listHookPhaseDefinitions,
  listHookPromptContextPolicyDefinitions,
  listHookScopeDefinitions,
  listHookTaskMapPlanPolicyDefinitions,
  listHookUiReservedTruths,
  listHookUiTargetDefinitions,
} from '../hooks/hook-contract.mjs';
import {
  HOOK_EVENTS,
  listHookEventDefinitions,
  listHooks,
  setHookEnabled,
} from '../hooks/runtime/registry.mjs';

export async function handleHooksRoutes({ req, res, pathname, writeJson } = {}) {
  // GET /api/hooks — list all registered hooks
  if (pathname === '/api/hooks' && req?.method === 'GET') {
    writeJson(res, 200, {
      events: HOOK_EVENTS,
      eventDefinitions: listHookEventDefinitions(),
      phaseDefinitions: listHookPhaseDefinitions(),
      phaseOrder: HOOK_PHASE_ORDER,
      scopeDefinitions: listHookScopeDefinitions(),
      scopeOrder: HOOK_SCOPE_ORDER,
      layerDefinitions: listHookLayerDefinitions(),
      layerOrder: HOOK_LAYER_ORDER,
      promptContextPolicyDefinitions: listHookPromptContextPolicyDefinitions(),
      promptContextPolicyOrder: HOOK_PROMPT_CONTEXT_POLICY_ORDER,
      taskMapPlanPolicyDefinitions: listHookTaskMapPlanPolicyDefinitions(),
      taskMapPlanPolicyOrder: HOOK_TASK_MAP_PLAN_POLICY_ORDER,
      uiTargetDefinitions: listHookUiTargetDefinitions(),
      uiReservedTruths: listHookUiReservedTruths(),
      hooks: listHooks(),
      settings: {
        persistence: 'file',
        storagePath: HOOKS_FILE,
        customDesignPath: CUSTOM_HOOKS_FILE,
        supportsEnableDisable: true,
      },
    });
    return true;
  }

  // PATCH /api/hooks/:id — enable or disable a hook
  if (pathname.startsWith('/api/hooks/') && req?.method === 'PATCH') {
    const hookId = decodeURIComponent(pathname.slice('/api/hooks/'.length));
    if (!hookId) {
      writeJson(res, 400, { error: 'hookId is required' });
      return true;
    }
    let body = {};
    try {
      const raw = await readBody(req, 4096);
      body = raw ? JSON.parse(raw) : {};
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    if (typeof body.enabled !== 'boolean') {
      writeJson(res, 400, { error: 'enabled (boolean) is required' });
      return true;
    }
    const found = setHookEnabled(hookId, body.enabled);
    if (!found) {
      writeJson(res, 404, { error: 'Hook not found' });
      return true;
    }
    await persistHookEnabledState(hookId, body.enabled);
    writeJson(res, 200, { hooks: listHooks() });
    return true;
  }

  return false;
}
