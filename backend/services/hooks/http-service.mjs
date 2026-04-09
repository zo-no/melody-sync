import { createHookSettingsPayload, updateHookEnabledState } from '../../settings/hooks.mjs';

export function getHookSettingsAliasPayload() {
  return createHookSettingsPayload();
}

export async function updateHookSettingsAlias(hookId, enabled) {
  return updateHookEnabledState(hookId, enabled);
}
