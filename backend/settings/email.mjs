import {
  persistEmailSettings,
  readEmailSettings,
} from '../email-settings-store.mjs';

export async function readEmailSettingsPayload() {
  return readEmailSettings();
}

export async function persistEmailSettingsPayload(payload = {}) {
  return persistEmailSettings(payload);
}
