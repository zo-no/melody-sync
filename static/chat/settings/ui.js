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
  let activeTabId = '';

  function getAvailableTabIds() {
    return tabButtonEls
      .filter((buttonEl) => buttonEl.hidden !== true)
      .map((buttonEl) => String(buttonEl.dataset.settingsTab || '').trim())
      .filter(Boolean);
  }

  function resolveActiveTabId(nextTabId) {
    const requestedId = String(nextTabId || '').trim();
    const availableTabIds = getAvailableTabIds();
    if (requestedId && availableTabIds.includes(requestedId)) {
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

  activeTabId = resolveActiveTabId('hooks');
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
