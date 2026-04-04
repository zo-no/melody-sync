(function nodeCanvasUiModule() {
  function createController({
    railContainerEl = null,
    railEl = null,
    headerEl = null,
    titleEl = null,
    summaryEl = null,
    bodyEl = null,
    expandBtn = null,
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

    let expanded = false;
    let dragState = null;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    function setStyleValue(target, propertyName, value) {
      if (!target?.style) return;
      if (typeof target.style.setProperty === "function") {
        target.style.setProperty(propertyName, value);
        return;
      }
      target.style[propertyName] = value;
    }

    function clearStyleValue(target, propertyName) {
      if (!target?.style) return;
      if (typeof target.style.removeProperty === "function") {
        target.style.removeProperty(propertyName);
        return;
      }
      target.style[propertyName] = "";
    }

    function updateDragPosition() {
      setStyleValue(railEl, "--task-canvas-drag-x", `${Math.round(dragOffsetX)}px`);
      setStyleValue(railEl, "--task-canvas-drag-y", `${Math.round(dragOffsetY)}px`);
    }

    function resetDragPosition() {
      dragOffsetX = 0;
      dragOffsetY = 0;
      clearStyleValue(railEl, "--task-canvas-drag-x");
      clearStyleValue(railEl, "--task-canvas-drag-y");
    }

    function setExpanded(nextExpanded, { resetPosition = false } = {}) {
      expanded = nextExpanded === true;
      railEl?.classList?.toggle?.("is-expanded", expanded);
      railContainerEl?.classList?.toggle?.("is-canvas-expanded", expanded);
      headerEl?.classList?.toggle?.("is-draggable", expanded);
      expandBtn?.classList?.toggle?.("is-active", expanded);
      if (expandBtn) {
        expandBtn.textContent = expanded ? "收起" : "展开";
        expandBtn.setAttribute?.("aria-pressed", expanded ? "true" : "false");
        expandBtn.setAttribute?.("aria-label", expanded ? "收起节点画布" : "展开节点画布");
        expandBtn.title = expanded ? "收起节点画布" : "展开节点画布";
      }
      if (!expanded || resetPosition) {
        resetDragPosition();
      } else {
        updateDragPosition();
      }
    }

    function finishDrag() {
      if (!dragState) return;
      dragState = null;
      railEl?.classList?.remove?.("is-dragging");
      headerEl?.classList?.remove?.("is-dragging");
    }

    function isHeaderInteractiveTarget(target) {
      if (!target || target === headerEl) return false;
      if (String(target?.tagName || "").toUpperCase() === "BUTTON") return true;
      if (typeof target?.closest === "function") {
        return Boolean(target.closest("button"));
      }
      return false;
    }

    function bindExpandedDrag() {
      const moveTarget = windowRef?.addEventListener ? windowRef : documentRef;
      if (!headerEl?.addEventListener || !moveTarget?.addEventListener) return;

      const startDrag = (clientX, clientY, target) => {
        if (!expanded || isHeaderInteractiveTarget(target)) return;
        dragState = {
          startX: Number(clientX || 0),
          startY: Number(clientY || 0),
          startOffsetX: dragOffsetX,
          startOffsetY: dragOffsetY,
        };
        railEl?.classList?.add?.("is-dragging");
        headerEl?.classList?.add?.("is-dragging");
      };

      const moveDrag = (clientX, clientY) => {
        if (!dragState || !expanded) return;
        const nextX = dragState.startOffsetX + (Number(clientX || 0) - dragState.startX);
        const nextY = dragState.startOffsetY + (Number(clientY || 0) - dragState.startY);
        dragOffsetX = nextX;
        dragOffsetY = nextY;
        updateDragPosition();
      };

      headerEl.addEventListener("mousedown", (event) => {
        startDrag(event?.clientX, event?.clientY, event?.target);
      });
      headerEl.addEventListener("touchstart", (event) => {
        const touch = event?.touches?.[0];
        startDrag(touch?.clientX, touch?.clientY, event?.target);
      }, { passive: true });
      moveTarget.addEventListener("mousemove", (event) => {
        moveDrag(event?.clientX, event?.clientY);
      });
      moveTarget.addEventListener("mouseup", () => {
        finishDrag();
      });
      moveTarget.addEventListener("touchmove", (event) => {
        const touch = event?.touches?.[0];
        moveDrag(touch?.clientX, touch?.clientY);
      }, { passive: true });
      moveTarget.addEventListener("touchend", () => {
        finishDrag();
      });
      moveTarget.addEventListener("touchcancel", () => {
        finishDrag();
      });
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
      finishDrag();
      setExpanded(false, { resetPosition: true });
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

    expandBtn?.addEventListener?.("click", () => {
      setExpanded(!expanded);
    });

    closeBtn?.addEventListener?.("click", () => {
      clear();
      if (typeof onClose === "function") onClose();
    });

    bindExpandedDrag();
    clear();

    return Object.freeze({
      renderNode,
      clear,
      isOpen() {
        return railEl?.hidden !== true;
      },
      isExpanded() {
        return expanded;
      },
      hasCanvasView,
      resolveNodeView,
    });
  }

  window.MelodySyncWorkbenchNodeCanvasUi = Object.freeze({
    createController,
  });
})();
