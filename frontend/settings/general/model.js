(function generalSettingsModelModule(global) {
  async function fetchSettings() {
    const response = await global.fetch('/api/settings', {
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  async function saveSettings(payload = {}) {
    const response = await global.fetch('/api/settings', {
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

  async function testCompletionSound() {
    const response = await global.fetch('/api/system/completion-sound', {
      method: 'POST',
      credentials: 'same-origin',
    });
    const next = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(next?.error || `HTTP ${response.status}`);
    }
    return next;
  }

  function scheduleReloadAfterConfigSwitch({ delayMs = 600, maxAttempts = 12 } = {}) {
    let attempts = 0;

    async function poll() {
      attempts += 1;
      try {
        const response = await global.fetch('/api/settings', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (response.ok) {
          global.location?.reload?.();
          return;
        }
      } catch {
        // Keep polling until the restarted service becomes reachable.
      }
      if (attempts < maxAttempts) {
        global.setTimeout?.(poll, delayMs);
      }
    }

    global.setTimeout?.(poll, delayMs);
  }

  global.MelodySyncGeneralSettingsModel = Object.freeze({
    fetchSettings,
    saveSettings,
    testCompletionSound,
    scheduleReloadAfterConfigSwitch,
  });
})(window);
