(function taskListUiModule() {
  function fallbackTaskMapRenderer(documentRef) {
    return {
      renderFlowBoard() {
        const empty = documentRef.createElement("div");
        empty.className = "task-map-empty";
        empty.textContent = "暂无任务地图。";
        return empty;
      },
    };
  }

  function createFallbackController({
    documentRef = document,
    trackerTaskListEl = null,
    taskMapRail = null,
    isMobileQuestTracker = () => false,
    isTaskMapExpanded = () => true,
    syncTaskMapDrawerUi = () => {},
    getTaskMapProjection = () => null,
    taskMapFlowRenderer = null,
  } = {}) {
    let lastRenderKey = "";

    const flowRenderer = taskMapFlowRenderer && typeof taskMapFlowRenderer.renderFlowBoard === "function"
      ? taskMapFlowRenderer
      : fallbackTaskMapRenderer(documentRef);

    function destroyRenderedBoard() {
      if (!trackerTaskListEl) return;
      const children = Array.from(trackerTaskListEl.children || []);
      for (const child of children) {
        const cleanup = child?.__melodysyncCleanup;
        if (typeof cleanup === "function") {
          cleanup();
        }
      }
    }

    function invalidate() {
      lastRenderKey = "";
    }

    function renderProjectedTaskList(state, activeQuest) {
      const nodeMap = new Map(
        (Array.isArray(activeQuest?.nodes) ? activeQuest.nodes : [])
          .filter((node) => node?.id)
          .map((node) => [node.id, node]),
      );
      const rootNode = nodeMap.get(`session:${activeQuest?.rootSessionId || ""}`) || null;
      const hasMapNodes = nodeMap.size > 0;
      const desktopTaskMap = !isMobileQuestTracker();
      const shouldMount = Boolean(
        state?.hasSession
        && (desktopTaskMap || hasMapNodes)
      );
      if (taskMapRail) taskMapRail.hidden = !shouldMount;
      trackerTaskListEl.classList.toggle("is-flow-board", shouldMount);
      syncTaskMapDrawerUi(shouldMount);
      if (!shouldMount) {
        destroyRenderedBoard();
        trackerTaskListEl.innerHTML = "";
        trackerTaskListEl.hidden = true;
        invalidate();
        return;
      }
      if (!isMobileQuestTracker() && !isTaskMapExpanded()) {
        destroyRenderedBoard();
        trackerTaskListEl.innerHTML = "";
        trackerTaskListEl.hidden = true;
        invalidate();
        return;
      }

      const nodeEntries = Array.isArray(activeQuest?.nodes)
        ? activeQuest.nodes.map((node) => [
          node?.id || "",
          node?.parentNodeId || "",
          node?.status || "",
          node?.kind || "",
          node?.title || "",
        ].join(":"))
        : [];
      const renderKey = [
        state?.session?.id || "",
        activeQuest?.id || "",
        activeQuest?.currentNodeId || "",
        nodeEntries.join("|"),
        String(flowRenderer.getRenderStateKey?.() || "").trim(),
      ].join("||");
      if (
        !trackerTaskListEl.hidden
        && trackerTaskListEl.children.length > 0
        && renderKey === lastRenderKey
      ) {
        return;
      }
      lastRenderKey = renderKey;
      destroyRenderedBoard();
      trackerTaskListEl.innerHTML = "";

      if (!rootNode) {
        const emptyState = documentRef.createElement("div");
        emptyState.className = "task-map-empty";
        emptyState.textContent = "暂无任务地图。";
        trackerTaskListEl.appendChild(emptyState);
        trackerTaskListEl.hidden = false;
        return;
      }

      trackerTaskListEl.appendChild(flowRenderer.renderFlowBoard({
        activeQuest,
        nodeMap,
        rootNode,
        state,
      }));
      trackerTaskListEl.hidden = trackerTaskListEl.children.length === 0;
    }

    function render(state) {
      if (!trackerTaskListEl) return;
      const activeQuest = getTaskMapProjection()?.activeMainQuest || null;
      if (!activeQuest) {
        destroyRenderedBoard();
        trackerTaskListEl.innerHTML = "";
        trackerTaskListEl.hidden = true;
        invalidate();
        return;
      }
      renderProjectedTaskList(state, activeQuest);
    }

    return {
      invalidate,
      render,
    };
  }

  function getWorkbenchReactUi(windowRef = window) {
    return globalThis?.MelodySyncWorkbenchReactUi
      || windowRef?.MelodySyncWorkbenchReactUi
      || windowRef?.window?.MelodySyncWorkbenchReactUi
      || null;
  }

  function canUseReactTaskListUi(options = {}) {
    const documentRef = options?.documentRef || globalThis?.document || document;
    return Boolean(
      documentRef
      && typeof documentRef.querySelector === "function"
      && typeof documentRef.createElement === "function",
    );
  }

  function createController(options = {}) {
    const windowRef = options?.windowRef || globalThis?.window || window;
    const reactFactory = getWorkbenchReactUi(windowRef)?.createTaskListController;
    if (typeof reactFactory === "function" && canUseReactTaskListUi(options)) {
      return reactFactory(options);
    }
    return createFallbackController(options);
  }

  window.MelodySyncTaskListUi = Object.freeze({
    createController,
  });
})();
