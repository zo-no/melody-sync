(function emailSettingsModelModule(global) {
  async function fetchSettings() {
    const response = await global.fetch('/api/settings/email', {
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  async function saveSettings(payload = {}) {
    const response = await global.fetch('/api/settings/email', {
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

  global.MelodySyncEmailSettingsModel = Object.freeze({
    fetchSettings,
    saveSettings,
  });
})(window);
