(function settingsPanelUiModule(global) {
  const documentRef = global.document;
  const overlayEl = documentRef?.getElementById?.('hooksOverlay');
  const openButtonEl = documentRef?.getElementById?.('hooksSettingsBtn');
  const closeButtonEl = documentRef?.getElementById?.('hooksOverlayClose');
  const tabButtonEls = Array.from(documentRef?.querySelectorAll?.('[data-settings-tab]') || []);
  const panelEls = Array.from(documentRef?.querySelectorAll?.('[data-settings-panel]') || []);

  if (!overlayEl || !openButtonEl || tabButtonEls.length === 0 || panelEls.length === 0) {
    return;
  }

  const tabRegistry = new Map();
  let catalogLoaded = false;
  let activeTabId = '';

  async function ensureCatalogLoaded() {
    if (catalogLoaded !== false) return;
    catalogLoaded = true;
    try {
      const response = await global.fetch?.('/api/settings/catalog', {
        credentials: 'same-origin',
      });
      if (!response?.ok) return;
      const payload = await response.json().catch(() => null);
      const supportedIds = new Set(
        (Array.isArray(payload?.sections) ? payload.sections : [])
          .map((entry) => String(entry?.id || '').trim())
          .filter(Boolean),
      );
      if (supportedIds.size === 0) return;
      tabButtonEls.forEach((buttonEl) => {
        const tabId = String(buttonEl.dataset.settingsTab || '').trim();
        buttonEl.hidden = !supportedIds.has(tabId);
      });
      panelEls.forEach((panelEl) => {
        const panelId = String(panelEl.dataset.settingsPanel || '').trim();
        if (!supportedIds.has(panelId)) {
          panelEl.hidden = true;
        }
      });
      syncTabs(activeTabId);
    } catch {}
  }

  function getVisibleTabIds() {
    return tabButtonEls
      .filter((buttonEl) => buttonEl.hidden !== true)
      .map((buttonEl) => String(buttonEl.dataset.settingsTab || '').trim())
      .filter(Boolean);
  }

  function getAvailableTabIds() {
    const visibleTabIds = getVisibleTabIds();
    const registeredVisibleTabIds = visibleTabIds.filter((tabId) => tabRegistry.has(tabId));
    return registeredVisibleTabIds.length > 0 ? registeredVisibleTabIds : visibleTabIds;
  }

  function resolveActiveTabId(nextTabId) {
    const requestedId = String(nextTabId || '').trim();
    const availableTabIds = getAvailableTabIds();
    const visibleTabIds = getVisibleTabIds();
    if (requestedId && visibleTabIds.includes(requestedId)) {
      return requestedId;
    }
    if (activeTabId && availableTabIds.includes(activeTabId)) {
      return activeTabId;
    }
    return availableTabIds[0] || '';
  }

  function syncTabs(nextTabId) {
    const resolvedId = resolveActiveTabId(nextTabId);
    activeTabId = resolvedId;
    tabButtonEls.forEach((buttonEl) => {
      const tabId = String(buttonEl.dataset.settingsTab || '').trim();
      const isActive = tabId === resolvedId;
      buttonEl.classList.toggle('is-active', isActive);
      buttonEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    panelEls.forEach((panelEl) => {
      const panelId = String(panelEl.dataset.settingsPanel || '').trim();
      panelEl.hidden = panelId !== resolvedId;
    });
    tabRegistry.get(resolvedId)?.onShow?.();
  }

  function open(tabId = '') {
    overlayEl.hidden = false;
    documentRef.body?.classList?.add?.('hooks-overlay-open');
    syncTabs(tabId);
  }

  function close() {
    overlayEl.hidden = true;
    documentRef.body?.classList?.remove?.('hooks-overlay-open');
  }

  function registerTab({ id, onShow } = {}) {
    const tabId = String(id || '').trim();
    if (!tabId) return;
    tabRegistry.set(tabId, {
      onShow: typeof onShow === 'function' ? onShow : null,
    });
    if (!overlayEl.hidden && tabId === activeTabId) {
      tabRegistry.get(tabId)?.onShow?.();
    }
  }

  function selectTab(tabId) {
    syncTabs(tabId);
  }

  openButtonEl.addEventListener('click', () => {
    void ensureCatalogLoaded();
    open();
  });

  closeButtonEl?.addEventListener('click', () => {
    close();
  });

  tabButtonEls.forEach((buttonEl) => {
    buttonEl.addEventListener('click', () => {
      selectTab(buttonEl.dataset.settingsTab);
    });
  });

  overlayEl.addEventListener('click', (event) => {
    if (event?.target === overlayEl) {
      close();
    }
  });

  documentRef.addEventListener('keydown', (event) => {
    if (event?.key === 'Escape' && !overlayEl.hidden) {
      close();
    }
  });

  activeTabId = resolveActiveTabId('general');
  syncTabs(activeTabId);
  close();

  global.MelodySyncSettingsPanel = Object.freeze({
    close,
    open,
    registerTab,
    selectTab,
  });

  try {
    if (typeof global.Event === 'function') {
      documentRef.dispatchEvent?.(new global.Event('melodysync:settings-panel-ready'));
    } else {
      documentRef.dispatchEvent?.({ type: 'melodysync:settings-panel-ready' });
    }
  } catch {}
})(window);
