(function sessionListReactUiModule() {
  function getSharedReactUi(windowRef = window) {
    return globalThis?.MelodySyncSessionListReactUi
      || windowRef?.MelodySyncSessionListReactUi
      || globalThis?.MelodySyncWorkbenchReactUi
      || windowRef?.MelodySyncWorkbenchReactUi
      || windowRef?.window?.MelodySyncSessionListReactUi
      || windowRef?.window?.MelodySyncWorkbenchReactUi
      || null;
  }

  function createRenderer(options = {}) {
    const windowRef = options?.windowRef || globalThis?.window || window;
    const reactFactory = getSharedReactUi(windowRef)?.createSessionListRenderer;
    if (typeof reactFactory !== 'function') return null;
    return reactFactory(options);
  }

  window.MelodySyncSessionListUi = Object.freeze({
    createRenderer,
  });
})();
