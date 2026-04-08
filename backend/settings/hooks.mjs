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
} from '../hooks/contract/index.mjs';
import {
  HOOK_EVENTS,
  listHookEventDefinitions,
  listHooks,
  setHookEnabled,
} from '../hooks/runtime/registry.mjs';

export function createHookSettingsPayload() {
  return {
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
  };
}

export async function updateHookEnabledState(hookId, enabled) {
  const normalizedHookId = String(hookId || '').trim();
  if (!normalizedHookId) {
    throw new Error('hookId is required');
  }
  if (typeof enabled !== 'boolean') {
    throw new Error('enabled (boolean) is required');
  }
  const found = setHookEnabled(normalizedHookId, enabled);
  if (!found) {
    throw new Error('Hook not found');
  }
  await persistHookEnabledState(normalizedHookId, enabled);
  return { hooks: listHooks() };
}
