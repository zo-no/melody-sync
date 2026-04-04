import {
  persistVoiceSettings,
  readVoiceSettings,
} from '../voice-settings-store.mjs';

export async function readVoiceSettingsPayload() {
  return readVoiceSettings();
}

export async function persistVoiceSettingsPayload(payload = {}) {
  return persistVoiceSettings(payload);
}
