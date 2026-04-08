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

  function createController({
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
        trackerTaskListEl.hidden = true;
        invalidate();
        return;
      }
      if (!isMobileQuestTracker() && !isTaskMapExpanded()) {
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
      ].join("||");
      if (
        !trackerTaskListEl.hidden
        && trackerTaskListEl.children.length > 0
        && renderKey === lastRenderKey
      ) {
        return;
      }
      lastRenderKey = renderKey;
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

  window.MelodySyncTaskListUi = Object.freeze({
    createController,
  });
})();
