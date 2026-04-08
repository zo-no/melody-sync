import {
  persistGeneralSettings,
  readGeneralSettings,
} from './general-store.mjs';

export async function readGeneralSettingsPayload() {
  return readGeneralSettings();
}

export async function persistGeneralSettingsPayload(payload = {}) {
  return persistGeneralSettings(payload);
}
