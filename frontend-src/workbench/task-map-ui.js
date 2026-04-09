(function taskMapUiAdapterModule() {
  function withRendererKind(renderer, rendererKind) {
    const baseRenderer = renderer && typeof renderer === "object"
      ? renderer
      : createEmptyRenderer();
    return Object.freeze({
      ...baseRenderer,
      rendererKind,
      getRendererKind() {
        return rendererKind;
      },
    });
  }

  function createEmptyRenderer(documentRef = document) {
    return {
      getRenderStateKey() {
        return "";
      },
      renderFlowBoard() {
        const empty = documentRef.createElement("div");
        empty.className = "task-map-empty";
        empty.textContent = "暂无任务地图。";
        return empty;
      },
    };
  }

  function createRenderer(options = {}) {
    const reactRendererFactory = globalThis?.MelodySyncTaskMapReactUi?.createRenderer
      || globalThis?.window?.MelodySyncTaskMapReactUi?.createRenderer
      || null;
    const legacyRendererFactory = globalThis?.MelodySyncTaskMapUiLegacy?.createRenderer
      || globalThis?.window?.MelodySyncTaskMapUiLegacy?.createRenderer
      || null;

    if (typeof reactRendererFactory === "function") {
      return withRendererKind(reactRendererFactory(options), "react-flow");
    }
    if (typeof legacyRendererFactory === "function") {
      return withRendererKind(legacyRendererFactory(options), "legacy-dom");
    }
    return withRendererKind(createEmptyRenderer(options?.documentRef || document), "empty");
  }

  window.MelodySyncTaskMapUi = Object.freeze({
    createRenderer,
  });
})();
