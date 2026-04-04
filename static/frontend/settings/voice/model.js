(function voiceSettingsModelModule(global) {
  async function fetchSettings() {
    const response = await global.fetch('/api/settings/voice', {
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  async function saveSettings(payload = {}) {
    const response = await global.fetch('/api/settings/voice', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const next = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(next?.error || `HTTP ${response.status}`);
    }
    return next;
  }

  global.MelodySyncVoiceSettingsModel = Object.freeze({
    fetchSettings,
    saveSettings,
  });
})(window);
