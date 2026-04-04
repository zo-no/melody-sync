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
    clipText = (value) => String(value || "").trim(),
    translate = (key) => key,
    renderChevronIcon = (expanded) => (expanded ? "▾" : "▸"),
    isMobileQuestTracker = () => false,
    isTaskMapExpanded = () => true,
    syncTaskMapDrawerUi = () => {},
    collapseTaskMapAfterAction = null,
    attachSession = null,
    getTaskMapProjection = () => null,
    getResolvedClusterCurrentBranchSessionId = () => "",
    getTaskCard = () => null,
    getTaskCardList = () => [],
    getClusterTitle = () => "",
    getBranchDisplayName = (session) => String(session?.name || "").trim(),
    getBranchStatusUi = () => ({ label: "进行中", summary: "" }),
    toConciseGoal = (value) => String(value || "").trim(),
    taskMapFlowRenderer = null,
    requestRender = null,
  } = {}) {
    let branchTreeExpansionState = new Map();
    let lastRenderKey = "";

    const flowRenderer = taskMapFlowRenderer && typeof taskMapFlowRenderer.renderFlowBoard === "function"
      ? taskMapFlowRenderer
      : fallbackTaskMapRenderer(documentRef);

    function invalidate() {
      lastRenderKey = "";
    }

    function compareBranchSessions(left, right, branchOrderMap) {
      const leftOrder = branchOrderMap.get(left?.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = branchOrderMap.get(right?.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;

      const leftCreated = Date.parse(left?.createdAt || left?.created || left?.updatedAt || left?.lastEventAt || "") || 0;
      const rightCreated = Date.parse(right?.createdAt || right?.created || right?.updatedAt || right?.lastEventAt || "") || 0;
      if (leftCreated !== rightCreated) return leftCreated - rightCreated;

      return String(left?.id || "").localeCompare(String(right?.id || ""));
    }

    function getBranchTreeActiveBranchId(state) {
      return getResolvedClusterCurrentBranchSessionId(
        state?.cluster,
        state?.isBranch ? state?.session?.id : (state?.focusedSessionId || state?.session?.id || ""),
      );
    }

    function getBranchTreeCurrentLineageIds(cluster, currentBranchSessionId = "") {
      const branchById = new Map(
        (Array.isArray(cluster?.branchSessions) ? cluster.branchSessions : [])
          .filter((entry) => entry?.id)
          .map((entry) => [entry.id, entry]),
      );
      const lineageIds = new Set();
      let cursor = currentBranchSessionId ? (branchById.get(currentBranchSessionId) || null) : null;
      while (cursor?.id && !lineageIds.has(cursor.id)) {
        lineageIds.add(cursor.id);
        const parentId = typeof cursor?._branchParentSessionId === "string"
          ? cursor._branchParentSessionId.trim()
          : "";
        if (!parentId || parentId === String(cluster?.mainSessionId || "").trim()) break;
        cursor = branchById.get(parentId) || null;
      }
      return lineageIds;
    }

    function getBranchTreeState(cluster, currentBranchSessionId = "") {
      const branchSessions = Array.isArray(cluster?.branchSessions)
        ? cluster.branchSessions.filter((entry) => entry?.id)
        : [];
      if (!branchSessions.length) {
        return {
          rootSessionId: String(cluster?.mainSessionId || "").trim(),
          branchSessions: [],
          branchById: new Map(),
          childrenByParent: new Map(),
          currentLineageIds: new Set(),
        };
      }

      const rootSessionId = String(cluster?.mainSessionId || "").trim();
      const branchById = new Map(branchSessions.map((entry) => [entry.id, entry]));
      const currentLineageIds = getBranchTreeCurrentLineageIds(cluster, currentBranchSessionId);
      const branchOrderMap = new Map(branchSessions.map((entry, index) => [entry.id, index]));
      const childrenByParent = new Map();

      for (const branchSession of branchSessions) {
        const parentId = typeof branchSession?._branchParentSessionId === "string" && branchSession._branchParentSessionId.trim()
          ? branchSession._branchParentSessionId.trim()
          : rootSessionId;
        const resolvedParentId = parentId && branchById.has(parentId) ? parentId : rootSessionId;
        if (!childrenByParent.has(resolvedParentId)) {
          childrenByParent.set(resolvedParentId, []);
        }
        childrenByParent.get(resolvedParentId).push(branchSession);
      }

      for (const [parentId, children] of childrenByParent.entries()) {
        childrenByParent.set(
          parentId,
          [...children].sort((left, right) => compareBranchSessions(left, right, branchOrderMap)),
        );
      }

      return {
        rootSessionId,
        branchSessions: [...branchSessions].sort((left, right) => compareBranchSessions(left, right, branchOrderMap)),
        branchById,
        childrenByParent,
        currentLineageIds,
      };
    }

    function getBranchRowSummary(branchSession) {
      const nextStep = getTaskCardList(getTaskCard(branchSession), "nextSteps")[0] || "";
      if (nextStep) return toConciseGoal(nextStep, 56);
      const branchStatus = String(branchSession?._branchStatus || "active").toLowerCase();
      if (branchStatus === "active") {
        return getBranchStatusUi(branchStatus).summary || "";
      }
      return "";
    }

    function getBranchTreeRootSummary(state) {
      const activePath = String(state?.activeBranchChain || "").trim();
      if (activePath) return activePath;
      const nextStep = clipText(state?.nextStep || "", 88);
      if (nextStep) return nextStep;
      const branchNames = Array.isArray(state?.branchNames)
        ? state.branchNames.filter((entry) => typeof entry === "string" && entry.trim())
        : [];
      if (branchNames.length > 0) {
        return branchNames.slice(0, 3).join("、");
      }
      return "";
    }

    function getBranchTreeRenderKey(state, treeState) {
      const branchEntries = Array.isArray(treeState?.branchSessions)
        ? treeState.branchSessions.map((entry) => [
          entry?.id || "",
          entry?._branchParentSessionId || "",
          entry?._branchStatus || "",
        ].join(":"))
        : [];
      const expansionKey = [...branchTreeExpansionState.entries()]
        .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
        .map(([sessionId, expanded]) => `${sessionId}:${expanded ? "1" : "0"}`)
        .join(",");
      return [
        state?.session?.id || "",
        getBranchTreeActiveBranchId(state),
        state?.isBranch ? "branch" : "main",
        getBranchTreeRootSummary(state),
        expansionKey,
        branchEntries.join("|"),
      ].join("||");
    }

    function pruneBranchTreeExpansionState(treeState) {
      const validIds = new Set(
        Array.isArray(treeState?.branchSessions)
          ? treeState.branchSessions.map((entry) => String(entry?.id || "").trim()).filter(Boolean)
          : [],
      );
      for (const sessionId of [...branchTreeExpansionState.keys()]) {
        if (!validIds.has(sessionId)) {
          branchTreeExpansionState.delete(sessionId);
        }
      }
    }

    function isBranchTreeNodeExpanded(sessionId, currentLineageIds, hasChildren) {
      const normalizedSessionId = String(sessionId || "").trim();
      if (!normalizedSessionId || !hasChildren) return false;
      if (branchTreeExpansionState.has(normalizedSessionId)) {
        return branchTreeExpansionState.get(normalizedSessionId) === true;
      }
      return currentLineageIds.has(normalizedSessionId);
    }

    function toggleBranchTreeNode(sessionId, expanded) {
      const normalizedSessionId = String(sessionId || "").trim();
      if (!normalizedSessionId) return;
      branchTreeExpansionState.set(normalizedSessionId, Boolean(expanded));
      invalidate();
      if (typeof requestRender === "function") {
        requestRender();
      }
    }

    function createTaskListItem({
      title,
      details = [],
      meta = "",
      metaClassName = "",
      current = false,
      onClick = null,
      status = "",
      extraClassName = "",
      expander = null,
    }) {
      const useButton = typeof onClick === "function" && !expander;
      const normalizedStatus = String(status || "").toLowerCase();
      const row = documentRef.createElement(useButton ? "button" : "div");
      if (row.type !== undefined && useButton) {
        row.type = "button";
      }
      row.className = `quest-task-item${extraClassName ? ` ${extraClassName}` : ""}`;
      if (expander) row.classList.add("has-expander");
      if (current) row.classList.add("is-current", "is-static");
      if (!current && typeof onClick !== "function") row.classList.add("is-static");
      if (normalizedStatus === "parked") row.classList.add("is-parked");
      if (normalizedStatus === "resolved" || normalizedStatus === "merged") row.classList.add("is-resolved");

      if (expander) {
        const expanderBtn = documentRef.createElement("button");
        expanderBtn.type = "button";
        expanderBtn.className = `quest-task-item-expander${expander.expanded ? " is-expanded" : ""}`;
        expanderBtn.innerHTML = renderChevronIcon(expander.expanded, "quest-task-item-expander-icon");
        expanderBtn.setAttribute("aria-label", expander.expanded ? "收起子任务" : "展开子任务");
        expanderBtn.title = expander.expanded ? "收起子任务" : "展开子任务";
        expanderBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          if (typeof expander.onToggle === "function") expander.onToggle();
        });
        row.appendChild(expanderBtn);
      }

      const main = documentRef.createElement("span");
      main.classList.add("quest-task-item-main");

      const titleEl = documentRef.createElement("span");
      titleEl.classList.add("quest-task-item-title");
      titleEl.textContent = clipText(title, 64);
      titleEl.title = String(title || "").trim();
      main.appendChild(titleEl);

      for (const detail of Array.isArray(details) ? details : []) {
        const text = String(detail?.text || "").trim();
        if (!text) continue;
        const detailEl = documentRef.createElement("span");
        detailEl.className = String(detail?.className || "quest-task-item-summary").trim() || "quest-task-item-summary";
        detailEl.textContent = clipText(text, Number(detail?.max) > 0 ? Number(detail.max) : 88);
        detailEl.title = text;
        main.appendChild(detailEl);
      }

      row.appendChild(main);

      if (meta) {
        const metaEl = documentRef.createElement("span");
        metaEl.classList.add("quest-task-item-meta");
        if (normalizedStatus === "parked") metaEl.classList.add("is-parked");
        if (normalizedStatus === "resolved" || normalizedStatus === "merged") metaEl.classList.add("is-complete");
        if (metaClassName) {
          String(metaClassName).split(/\s+/).filter(Boolean).forEach((token) => metaEl.classList.add(token));
        }
        metaEl.textContent = meta;
        row.appendChild(metaEl);
      }

      if (current) {
        row.setAttribute("aria-current", "true");
      }
      if (typeof onClick === "function") {
        row.addEventListener("click", onClick);
      }
      return row;
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

    function renderBranchTree(state) {
      trackerTaskListEl.classList.remove("is-flow-board");
      const desktopTaskMap = !isMobileQuestTracker();
      const activeBranchId = getBranchTreeActiveBranchId(state);
      const treeState = getBranchTreeState(state?.cluster, activeBranchId);
      const hasVisibleBranches = treeState.branchSessions.length > 0;
      const shouldMount = Boolean(
        state?.hasSession
        && (desktopTaskMap || hasVisibleBranches)
      );
      if (taskMapRail) taskMapRail.hidden = !shouldMount;
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

      const canRenderStableTree = !state?.cluster?._isLocalFallback;
      pruneBranchTreeExpansionState(treeState);
      const renderKey = getBranchTreeRenderKey(state, treeState);
      if (
        canRenderStableTree
        && !trackerTaskListEl.hidden
        && trackerTaskListEl.children.length > 0
        && renderKey === lastRenderKey
      ) {
        return;
      }
      lastRenderKey = canRenderStableTree ? renderKey : "";
      trackerTaskListEl.innerHTML = "";

      const rootSessionId = String(state?.cluster?.mainSessionId || state?.parentSessionId || "").trim();
      const rootCard = createTaskListItem({
        title: state.mainGoal || getClusterTitle(state?.cluster),
        details: [{
          text: getBranchTreeRootSummary(state),
          className: "quest-task-item-summary",
          max: 112,
        }],
        meta: state.isBranch ? "主任务" : "当前主任务",
        current: !state.isBranch,
        status: "main",
        extraClassName: "quest-task-mindmap-root",
        onClick: state.isBranch && rootSessionId ? () => {
          if (typeof attachSession === "function") {
            if (typeof collapseTaskMapAfterAction === "function") {
              collapseTaskMapAfterAction({ render: false });
            }
            attachSession(rootSessionId, state.parentSession || state?.cluster?.mainSession || null);
          }
        } : null,
      });
      trackerTaskListEl.appendChild(rootCard);

      if (!hasVisibleBranches) {
        const emptyState = documentRef.createElement("div");
        emptyState.className = "task-map-empty";
        const emptyLabel = translate("taskMap.empty");
        emptyState.textContent = emptyLabel && emptyLabel !== "taskMap.empty"
          ? emptyLabel
          : "暂无支线，后续任务流程会显示在这里。";
        trackerTaskListEl.appendChild(emptyState);
        trackerTaskListEl.hidden = false;
        return;
      }

      if (!canRenderStableTree) {
        trackerTaskListEl.hidden = false;
        return;
      }

      const directory = documentRef.createElement("div");
      directory.className = "quest-task-directory";

      const createDirectoryBranch = (branchSession, depth = 1) => {
        const branchItem = documentRef.createElement("div");
        branchItem.className = `quest-task-directory-item depth-${Math.min(depth, 6)}`;
        const children = treeState.childrenByParent.get(branchSession.id) || [];
        const hasChildren = children.length > 0;
        const isExpanded = isBranchTreeNodeExpanded(branchSession.id, treeState.currentLineageIds, hasChildren);
        const branchStatus = String(branchSession?._branchStatus || "active").toLowerCase();
        const isCurrentBranch = branchSession.id === activeBranchId;
        const isCurrentChain = treeState.currentLineageIds.has(branchSession.id);
        const details = [];
        const parentId = typeof branchSession?._branchParentSessionId === "string"
          ? branchSession._branchParentSessionId.trim()
          : "";
        const parentBranch = parentId ? (treeState.branchById.get(parentId) || null) : null;
        if (parentBranch) {
          details.push({
            text: `上级：${getBranchDisplayName(parentBranch)}`,
            className: "quest-task-item-parent",
            max: 72,
          });
        }
        const summary = getBranchRowSummary(branchSession);
        if (summary) {
          details.push({
            text: summary,
            className: "quest-task-item-summary",
            max: 88,
          });
        }

        const row = createTaskListItem({
          title: getBranchDisplayName(branchSession),
          details,
          meta: isCurrentBranch
            ? "当前位置"
            : (isCurrentChain ? "当前路径" : (hasChildren ? `子任务 ${children.length}` : getBranchStatusUi(branchStatus).label)),
          current: isCurrentBranch,
          status: branchStatus,
          extraClassName: "quest-task-directory-row",
          expander: hasChildren ? {
            expanded: isExpanded,
            onToggle: () => toggleBranchTreeNode(branchSession.id, !isExpanded),
          } : null,
          onClick: () => {
            if (typeof attachSession === "function") {
              if (typeof collapseTaskMapAfterAction === "function") {
                collapseTaskMapAfterAction({ render: false });
              }
              attachSession(branchSession.id, branchSession);
            }
          },
        });
        if (hasChildren) branchItem.classList.add("has-children");
        if (isExpanded) branchItem.classList.add("is-expanded");
        if (isCurrentChain) row.classList.add("is-current-chain");
        if (isCurrentBranch) row.classList.add("is-current-branch");
        if (isCurrentChain) branchItem.classList.add("is-current-chain");
        if (isCurrentBranch) branchItem.classList.add("is-current-branch");
        branchItem.appendChild(row);

        if (hasChildren && isExpanded) {
          const childrenWrap = documentRef.createElement("div");
          childrenWrap.className = "quest-task-directory-children";
          for (const childBranch of children) {
            childrenWrap.appendChild(createDirectoryBranch(childBranch, depth + 1));
          }
          branchItem.appendChild(childrenWrap);
        }

        return branchItem;
      };

      for (const branchSession of treeState.childrenByParent.get(rootSessionId) || []) {
        directory.appendChild(createDirectoryBranch(branchSession, 1));
      }

      trackerTaskListEl.appendChild(directory);
      trackerTaskListEl.hidden = trackerTaskListEl.children.length === 0;
    }

    function render(state) {
      if (!trackerTaskListEl) return;
      const activeQuest = getTaskMapProjection()?.activeMainQuest || null;
      if (activeQuest) {
        renderProjectedTaskList(state, activeQuest);
        return;
      }
      renderBranchTree(state);
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
