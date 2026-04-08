import {
  persistEmailSettings,
  readEmailSettings,
} from './email-store.mjs';

export async function readEmailSettingsPayload() {
  return readEmailSettings();
}

export async function persistEmailSettingsPayload(payload = {}) {
  return persistEmailSettings(payload);
}
