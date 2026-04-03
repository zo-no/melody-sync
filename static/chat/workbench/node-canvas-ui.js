(function nodeCanvasUiModule() {
  function createController({
    railEl = null,
    titleEl = null,
    summaryEl = null,
    bodyEl = null,
    closeBtn = null,
    documentRef = document,
    windowRef = window,
    onClose = null,
  } = {}) {
    const richViewRenderer = windowRef?.MelodySyncWorkbenchNodeRichViewUi?.createRenderer?.({
      documentRef,
      windowRef,
    }) || null;

    function trimText(value) {
      return typeof value === "string" ? value.trim() : "";
    }

    function resolveNodeView(node = null) {
      const raw = node?.view && typeof node.view === "object"
        ? node.view
        : { type: "flow-node" };
      const type = trimText(raw.type).toLowerCase() || "flow-node";
      return {
        type,
        content: typeof raw.content === "string" ? raw.content : "",
        src: typeof raw.src === "string" ? raw.src : "",
        renderMode: trimText(raw.renderMode).toLowerCase(),
        width: Number.isFinite(raw.width) ? raw.width : null,
        height: Number.isFinite(raw.height) ? raw.height : null,
      };
    }

    function hasCanvasView(node = null) {
      return resolveNodeView(node).type !== "flow-node";
    }

    function setOpen(open) {
      const nextOpen = open === true;
      if (railEl) {
        railEl.hidden = !nextOpen;
        railEl.classList?.toggle?.("is-open", nextOpen);
      }
    }

    function clear() {
      if (titleEl) titleEl.textContent = "";
      if (summaryEl) {
        summaryEl.textContent = "";
        summaryEl.hidden = true;
      }
      if (bodyEl) bodyEl.innerHTML = "";
      setOpen(false);
    }

    function renderNode(node = null) {
      if (!node || !hasCanvasView(node) || !richViewRenderer) {
        clear();
        return false;
      }

      const summary = trimText(node?.summary);
      if (titleEl) {
        titleEl.textContent = trimText(node?.title) || "节点画布";
      }
      if (summaryEl) {
        summaryEl.hidden = !summary;
        summaryEl.textContent = summary;
      }
      if (bodyEl) {
        bodyEl.innerHTML = "";
        bodyEl.appendChild(richViewRenderer.createRichViewSurface(node, resolveNodeView(node)));
      }
      setOpen(true);
      return true;
    }

    closeBtn?.addEventListener?.("click", () => {
      clear();
      if (typeof onClose === "function") onClose();
    });

    clear();

    return Object.freeze({
      renderNode,
      clear,
      isOpen() {
        return railEl?.hidden !== true;
      },
      hasCanvasView,
      resolveNodeView,
    });
  }

  window.MelodySyncWorkbenchNodeCanvasUi = Object.freeze({
    createController,
  });
})();
