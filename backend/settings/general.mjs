import {
  persistGeneralSettings,
  readGeneralSettings,
} from '../settings-store.mjs';

export async function readGeneralSettingsPayload() {
  return readGeneralSettings();
}

export async function persistGeneralSettingsPayload(payload = {}) {
  return persistGeneralSettings(payload);
}
