(function taskMapUiModule() {
  function createRenderer({
    documentRef = document,
    windowRef = window,
    isMobileQuestTracker = () => false,
    clipText = (value) => String(value || "").trim(),
    translate = (key) => key,
    getBranchStatusUi = () => ({ label: "进行中", summary: "" }),
    collapseTaskMapAfterAction = null,
    enterBranchFromSession = null,
    getSessionRecord = null,
    attachSession = null,
    selectTaskCanvasNode = null,
    getSelectedTaskCanvasNodeId = () => "",
  } = {}) {
    function getNodeEffectsApi() {
      return globalThis?.MelodySyncWorkbenchNodeEffects
        || windowRef?.MelodySyncWorkbenchNodeEffects
        || windowRef?.window?.MelodySyncWorkbenchNodeEffects
        || null;
    }

    function getNodeCapabilitiesApi() {
      return globalThis?.MelodySyncWorkbenchNodeCapabilities
        || windowRef?.MelodySyncWorkbenchNodeCapabilities
        || windowRef?.window?.MelodySyncWorkbenchNodeCapabilities
        || null;
    }

    function getNodeEffect(node) {
      return getNodeEffectsApi()?.getNodeEffect?.(node) || node?.kindEffect || null;
    }

    function getNodeLayoutVariant(node) {
      return getNodeEffect(node)?.layoutVariant || "default";
    }

    function createFallbackNodeActionController() {
      return {
        hasNodeCapability(node, capability) {
          const normalizedCapability = String(capability || "").trim().toLowerCase();
          if (!normalizedCapability) return false;
          const capabilities = getNodeEffectsApi()?.getNodeCapabilities?.(node) || [];
          return capabilities.includes(normalizedCapability);
        },
        resolvePrimaryAction(node, { isRichView = false, isDone = false } = {}) {
          if (isRichView || isDone) return "none";
          if (this.hasNodeCapability(node, "create-branch")) return "create-branch";
          if (this.hasNodeCapability(node, "open-session") && node?.sessionId) return "open-session";
          return "none";
        },
        isNodeDirectlyInteractive(node, options = {}) {
          return this.resolvePrimaryAction(node, options) === "open-session";
        },
        async executePrimaryAction(node, { state = null, nodeMap = new Map(), isRichView = false, isDone = false } = {}) {
          const action = this.resolvePrimaryAction(node, { isRichView, isDone });
          if (action === "create-branch") {
            const sourceSessionId = String(node?.sessionId || node?.sourceSessionId || "").trim();
            if (!sourceSessionId) return false;
            collapseTaskMapAfterAction?.({ render: false });
            await enterBranchFromSession?.(sourceSessionId, node.title, {
              branchReason: node?.parentNodeId
                ? `从「${nodeMap.get(node.parentNodeId)?.title || "当前节点"}」继续拆出独立支线`
                : "从当前任务拆出独立支线",
              checkpointSummary: node.title,
            });
            return true;
          }
          if (action === "open-session" && node?.sessionId) {
            const sessionRecord = getSessionRecord?.(node.sessionId) || state?.parentSession || state?.cluster?.mainSession || null;
            collapseTaskMapAfterAction?.({ render: false });
            attachSession?.(node.sessionId, sessionRecord);
            return true;
          }
          return false;
        },
      };
    }

    function getNodeActionController() {
      const api = getNodeCapabilitiesApi();
      if (typeof api?.createController === "function") {
        return api.createController({
          collapseTaskMapAfterAction,
          enterBranchFromSession,
          getSessionRecord,
          attachSession,
        });
      }
      return createFallbackNodeActionController();
    }

    function getNodeEdgeVariant(node) {
      return getNodeEffect(node)?.edgeVariant || "structural";
    }

    function getNodeActionLabel(node) {
      return getNodeEffect(node)?.actionLabel || "开启支线";
    }

    function getNodeView(node) {
      return getNodeEffectsApi()?.getNodeView?.(node) || {
        type: "flow-node",
        renderMode: "",
        content: "",
        src: "",
        width: null,
        height: null,
      };
    }

    function getNodeViewLabel(nodeView = null) {
      switch (String(nodeView?.type || "").trim().toLowerCase()) {
        case "markdown":
          return "在右侧画布查看 Markdown";
        case "html":
          return "在右侧画布查看 HTML";
        case "iframe":
          return "在右侧画布查看嵌入内容";
        default:
          return "在右侧画布查看内容";
      }
    }

    function getProjectedTaskFlowConfig() {
      const mobile = isMobileQuestTracker();
      return {
        nodeWidth: mobile ? 152 : 176,
        rootWidth: mobile ? 176 : 208,
        panelWidth: mobile ? 276 : 360,
        nodeHeight: mobile ? 88 : 96,
        rootHeight: mobile ? 98 : 112,
        candidateHeight: mobile ? 108 : 120,
        panelHeight: mobile ? 196 : 256,
        iframeHeight: mobile ? 220 : 280,
        levelGap: mobile ? 98 : 116,
        siblingGap: mobile ? 18 : 20,
        paddingX: mobile ? 144 : 220,
        paddingY: mobile ? 112 : 168,
        overscanX: mobile ? 220 : 360,
        overscanY: mobile ? 240 : 320,
      };
    }

    function getProjectedTaskFlowNodeChildren(node, nodeMap) {
      return Array.isArray(node?.childNodeIds)
        ? node.childNodeIds.map((childId) => nodeMap.get(childId)).filter(Boolean)
        : [];
    }

    function getProjectedTaskFlowNodeWidth(node, metrics) {
      const nodeView = getNodeView(node);
      if (Number.isFinite(nodeView?.width) && nodeView.width > 0) return nodeView.width;
      if (nodeView?.type && nodeView.type !== "flow-node") return metrics.panelWidth;
      return node?.parentNodeId ? metrics.nodeWidth : metrics.rootWidth;
    }

    function getProjectedTaskFlowNodeHeight(node, metrics) {
      const nodeView = getNodeView(node);
      if (Number.isFinite(nodeView?.height) && nodeView.height > 0) return nodeView.height;
      if (nodeView?.type === "iframe") return metrics.iframeHeight;
      if (nodeView?.type && nodeView.type !== "flow-node") return metrics.panelHeight;
      if (!node?.parentNodeId) return metrics.rootHeight;
      if (getNodeLayoutVariant(node) === "compact") return metrics.candidateHeight;
      return metrics.nodeHeight;
    }

    function buildProjectedTaskFlowTree(nodeId, nodeMap) {
      const node = nodeMap.get(nodeId);
      if (!node) return null;
      return {
        node,
        children: getProjectedTaskFlowNodeChildren(node, nodeMap)
          .map((child) => buildProjectedTaskFlowTree(child.id, nodeMap))
          .filter(Boolean),
        width: 0,
        x: 0,
        y: 0,
        nodeWidth: 0,
        nodeHeight: 0,
      };
    }

    function measureProjectedTaskFlowTree(tree, metrics) {
      if (!tree) return 0;
      const nodeWidth = getProjectedTaskFlowNodeWidth(tree.node, metrics);
      if (!tree.children.length) {
        tree.width = nodeWidth;
        return tree.width;
      }
      const childWidths = tree.children.map((child) => measureProjectedTaskFlowTree(child, metrics));
      const childrenWidth = childWidths.reduce((sum, width) => sum + width, 0)
        + Math.max(0, tree.children.length - 1) * metrics.siblingGap;
      tree.width = Math.max(nodeWidth, childrenWidth);
      return tree.width;
    }

    function positionProjectedTaskFlowTree(tree, left, top, metrics) {
      if (!tree) return;
      tree.nodeWidth = getProjectedTaskFlowNodeWidth(tree.node, metrics);
      tree.nodeHeight = getProjectedTaskFlowNodeHeight(tree.node, metrics);
      tree.x = left + Math.max(0, (tree.width - tree.nodeWidth) / 2);
      tree.y = top;
      if (!tree.children.length) return;

      const childrenWidth = tree.children.reduce((sum, child) => sum + child.width, 0)
        + Math.max(0, tree.children.length - 1) * metrics.siblingGap;
      let cursor = left + Math.max(0, (tree.width - childrenWidth) / 2);
      const nextTop = top + tree.nodeHeight + metrics.levelGap;
      for (const child of tree.children) {
        positionProjectedTaskFlowTree(child, cursor, nextTop, metrics);
        cursor += child.width + metrics.siblingGap;
      }
    }

    function flattenProjectedTaskFlowTree(tree, results = []) {
      if (!tree) return results;
      results.push(tree);
      for (const child of tree.children) {
        flattenProjectedTaskFlowTree(child, results);
      }
      return results;
    }

    function collectProjectedTaskFlowEdges(tree, edgeByTargetNodeId = new Map(), results = []) {
      if (!tree) return results;
      for (const child of tree.children) {
        const edge = edgeByTargetNodeId.get(child.node?.id) || null;
        results.push({
          fromX: tree.x + tree.nodeWidth / 2,
          fromY: tree.y + tree.nodeHeight,
          toX: child.x + child.nodeWidth / 2,
          toY: child.y,
          current: child.node?.isCurrent === true || child.node?.isCurrentPath === true,
          variant: edge?.type || getNodeEdgeVariant(child.node),
        });
        collectProjectedTaskFlowEdges(child, edgeByTargetNodeId, results);
      }
      return results;
    }

    function createSvgElement(tagName) {
      if (typeof documentRef?.createElementNS === "function") {
        return documentRef.createElementNS("http://www.w3.org/2000/svg", tagName);
      }
      return documentRef.createElement(tagName);
    }

    function clampNumber(value, min, max) {
      if (!Number.isFinite(value)) return min;
      if (!Number.isFinite(min) && !Number.isFinite(max)) return value;
      if (!Number.isFinite(min)) return Math.min(value, max);
      if (!Number.isFinite(max)) return Math.max(value, min);
      return Math.min(Math.max(value, min), max);
    }

    function getProjectedTaskFlowNodeMeta(node) {
      const nodeEffect = getNodeEffect(node);
      const label = getNodeEffectsApi()?.getNodeMetaLabel?.(node, { getBranchStatusUi });
      if (label) return label;
      if (!node?.parentNodeId) return "进行中";
      if (nodeEffect?.metaVariant === "candidate") return "可选";
      if (nodeEffect?.metaVariant === "done") return "已收束";
      return getBranchStatusUi(node.status).label;
    }

    function getProjectedTaskFlowNodeSummary(node, activeQuest) {
      const summary = getNodeEffectsApi()?.getNodeSummaryText?.(node, activeQuest, { clipText });
      if (typeof summary === "string") return summary;
      if (!node) return "";
      const nodeEffect = getNodeEffect(node);
      if (!node.parentNodeId) {
        const rootSummary = clipText(node.summary || activeQuest?.summary || "", 72);
        if (rootSummary) return rootSummary;
        const currentNodeTitle = clipText(activeQuest?.currentNodeTitle || "", 40);
        if (currentNodeTitle && currentNodeTitle !== clipText(node.title || "", 40)) {
          return `当前焦点：${currentNodeTitle}`;
        }
        return "";
      }
      if (nodeEffect?.interaction === "create-branch") {
        return clipText(node.summary || nodeEffect.fallbackSummary || nodeEffect.defaultSummary || "", 72);
      }
      return clipText(node.summary || nodeEffect?.fallbackSummary || "", 72);
    }

    function bindTaskFlowCanvasInteractions(scroll) {
      if (!scroll || scroll.dataset.taskFlowInteractionsBound === "true") return;
      scroll.dataset.taskFlowInteractionsBound = "true";

      let dragState = null;
      let startX = 0;
      let startY = 0;
      let startPanX = 0;
      let startPanY = 0;
      let suppressClickUntil = 0;

      const reset = () => {
        dragState = null;
        scroll.classList.remove("is-pointer-down", "is-dragging");
      };

      const canStartPan = (target) => {
        if (typeof Element === "undefined" || !(target instanceof Element)) return true;
        return !target.closest(".panzoom-exclude");
      };

      const readPan = () => {
        const panzoom = scroll._taskFlowPanzoom;
        if (panzoom && typeof panzoom.getPan === "function") {
          return panzoom.getPan();
        }
        return {
          x: -Number(scroll.scrollLeft || 0),
          y: -Number(scroll.scrollTop || 0),
        };
      };

      const applyPan = (x, y) => {
        const panzoom = scroll._taskFlowPanzoom;
        if (panzoom && typeof panzoom.pan === "function") {
          panzoom.pan(x, y, { force: true });
          return;
        }
        scroll.scrollLeft = Math.max(0, -x);
        scroll.scrollTop = Math.max(0, -y);
      };

      const startDrag = (clientX, clientY, target) => {
        if (!canStartPan(target)) return false;
        startX = clientX;
        startY = clientY;
        const currentPan = readPan();
        startPanX = Number(currentPan?.x || 0);
        startPanY = Number(currentPan?.y || 0);
        dragState = { dragging: false };
        scroll.classList.add("is-pointer-down");
        return true;
      };

      const updateDrag = (clientX, clientY, event) => {
        if (!dragState) return;
        const deltaX = clientX - startX;
        const deltaY = clientY - startY;
        if (!dragState.dragging && Math.hypot(deltaX, deltaY) >= 6) {
          dragState.dragging = true;
          scroll.classList.add("is-dragging");
        }
        if (!dragState.dragging) return;
        event.preventDefault?.();
        applyPan(startPanX + deltaX, startPanY + deltaY);
      };

      const finishDrag = () => {
        if (!dragState) return;
        const didDrag = dragState.dragging === true;
        reset();
        if (didDrag) {
          suppressClickUntil = Date.now() + 180;
        }
      };

      scroll.addEventListener("dragstart", (event) => {
        event.preventDefault();
      });
      scroll.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        startDrag(event.clientX, event.clientY, event.target);
      });
      documentRef.addEventListener("mousemove", (event) => {
        updateDrag(event.clientX, event.clientY, event);
      });
      documentRef.addEventListener("mouseup", () => {
        finishDrag();
      });
      scroll.addEventListener("touchstart", (event) => {
        if (!event.touches || event.touches.length !== 1) return;
        const touch = event.touches[0];
        startDrag(touch.clientX, touch.clientY, event.target);
      }, { passive: true });
      scroll.addEventListener("touchmove", (event) => {
        if (!event.touches || event.touches.length !== 1) return;
        const touch = event.touches[0];
        updateDrag(touch.clientX, touch.clientY, event);
      }, { passive: false });
      scroll.addEventListener("touchend", () => {
        finishDrag();
      }, { passive: true });
      scroll.addEventListener("touchcancel", () => {
        finishDrag();
      }, { passive: true });
      scroll.addEventListener("click", (event) => {
        if (Date.now() <= suppressClickUntil) {
          event.preventDefault();
          event.stopPropagation();
        }
      }, true);
    }

    function initializeTaskFlowCanvasViewport({
      scroll,
      canvas,
      svg = null,
      focusCenterX = 0,
      focusCenterY = 0,
      focusTopY = 0,
      contentWidth = 0,
      contentHeight = 0,
      metrics = null,
    }) {
      if (!scroll || !canvas) return;
      const viewportWidth = Number(scroll?.clientWidth || scroll?.offsetWidth || 0);
      const viewportHeight = Number(scroll?.clientHeight || scroll?.offsetHeight || 0);
      if (viewportWidth <= 0 || viewportHeight <= 0) return;

      const overscanX = Number(metrics?.overscanX || 0);
      const overscanY = Number(metrics?.overscanY || 0);
      const nextCanvasWidth = Math.max(Number(contentWidth || canvas?.offsetWidth || canvas?.scrollWidth || 0), viewportWidth + overscanX);
      const nextCanvasHeight = Math.max(Number(contentHeight || canvas?.offsetHeight || canvas?.scrollHeight || 0), viewportHeight + overscanY);
      if (nextCanvasWidth <= 0 || nextCanvasHeight <= 0) return;

      canvas.style.width = `${Math.ceil(nextCanvasWidth)}px`;
      canvas.style.height = `${Math.ceil(nextCanvasHeight)}px`;
      if (svg && typeof svg.setAttribute === "function") {
        svg.setAttribute("viewBox", `0 0 ${Math.ceil(nextCanvasWidth)} ${Math.ceil(nextCanvasHeight)}`);
        svg.setAttribute("width", String(Math.ceil(nextCanvasWidth)));
        svg.setAttribute("height", String(Math.ceil(nextCanvasHeight)));
      }

      const targetX = clampNumber((viewportWidth / 2) - focusCenterX, Math.min(0, viewportWidth - nextCanvasWidth), 0);
      const targetY = clampNumber(Math.min(metrics?.paddingY || 0, viewportHeight * 0.18) - focusTopY, Math.min(0, viewportHeight - nextCanvasHeight), 0);

      const PanzoomFactory = typeof windowRef !== "undefined" ? windowRef.Panzoom : null;
      if (typeof PanzoomFactory === "function") {
        try {
          if (scroll._taskFlowPanzoom && typeof scroll._taskFlowPanzoom.destroy === "function") {
            scroll._taskFlowPanzoom.destroy();
          }
          const panzoom = PanzoomFactory(canvas, {
            canvas: true,
            noBind: true,
            disableZoom: true,
            animate: false,
            cursor: "grab",
            excludeClass: "panzoom-exclude",
            overflow: "hidden",
            touchAction: "none",
            startX: targetX,
            startY: targetY,
          });
          scroll._taskFlowPanzoom = panzoom;
          bindTaskFlowCanvasInteractions(scroll);
          scroll.classList.add("is-panzoom-ready");
          panzoom.pan(targetX, targetY, { force: true });
          return;
        } catch (error) {
          console.warn("[quest] Failed to initialize task flow panzoom:", error?.message || error);
        }
      }

      scroll.classList.remove("is-panzoom-ready");
      scroll.scrollLeft = Math.max(0, focusCenterX - (viewportWidth / 2));
      scroll.scrollTop = Math.max(0, focusCenterY - Math.min(viewportHeight * 0.42, viewportHeight / 2));
    }

    function renderFlowBoard({ activeQuest, nodeMap, rootNode, state }) {
      const metrics = getProjectedTaskFlowConfig();
      const tree = buildProjectedTaskFlowTree(rootNode.id, nodeMap);
      measureProjectedTaskFlowTree(tree, metrics);
      positionProjectedTaskFlowTree(tree, metrics.paddingX, metrics.paddingY, metrics);

      const entries = flattenProjectedTaskFlowTree(tree, []);
      const edgeByTargetNodeId = new Map(
        (Array.isArray(activeQuest?.edges) ? activeQuest.edges : [])
          .filter((edge) => edge?.toNodeId)
          .map((edge) => [edge.toNodeId, edge]),
      );
      const edges = collectProjectedTaskFlowEdges(tree, edgeByTargetNodeId, []);
      const canvasWidth = Math.max(metrics.rootWidth + metrics.paddingX * 2, ...entries.map((entry) => entry.x + entry.nodeWidth + metrics.paddingX));
      const canvasHeight = Math.max(metrics.rootHeight + metrics.paddingY * 2, ...entries.map((entry) => entry.y + entry.nodeHeight + metrics.paddingY));

      const board = documentRef.createElement("div");
      board.className = "quest-task-mindmap-board is-spine quest-task-flow-shell";

      const scroll = documentRef.createElement("div");
      scroll.className = "quest-task-flow-scroll";

      const canvas = documentRef.createElement("div");
      canvas.className = "quest-task-flow-canvas";
      canvas.style.width = `${Math.ceil(canvasWidth)}px`;
      canvas.style.height = `${Math.ceil(canvasHeight)}px`;

      const svg = createSvgElement("svg");
      if (typeof svg.setAttribute === "function") {
        svg.setAttribute("class", "quest-task-flow-edges");
        svg.setAttribute("viewBox", `0 0 ${Math.ceil(canvasWidth)} ${Math.ceil(canvasHeight)}`);
        svg.setAttribute("width", String(Math.ceil(canvasWidth)));
        svg.setAttribute("height", String(Math.ceil(canvasHeight)));
        svg.setAttribute("aria-hidden", "true");
      } else {
        svg.className = "quest-task-flow-edges";
      }

      for (const edge of edges) {
        const path = createSvgElement("path");
        const midY = edge.fromY + ((edge.toY - edge.fromY) * 0.48);
        if (typeof path.setAttribute === "function") {
          path.setAttribute("d", `M ${edge.fromX} ${edge.fromY} V ${midY} H ${edge.toX} V ${edge.toY}`);
          path.setAttribute("class", `quest-task-flow-edge${edge.current ? " is-current" : ""}${edge.variant === "suggestion" ? " is-candidate" : ""}`);
        } else {
          path.className = `quest-task-flow-edge${edge.current ? " is-current" : ""}${edge.variant === "suggestion" ? " is-candidate" : ""}`;
        }
        svg.appendChild(path);
      }
      canvas.appendChild(svg);

      const nodeActionController = getNodeActionController();

      const createCandidateAction = (node) => {
        const actionBtn = documentRef.createElement("button");
        actionBtn.type = "button";
        actionBtn.className = "quest-branch-btn quest-branch-btn-primary quest-task-flow-node-action panzoom-exclude";
        actionBtn.textContent = getNodeActionLabel(node);
        if (!nodeActionController.hasNodeCapability(node, "create-branch")) {
          actionBtn.disabled = true;
          return actionBtn;
        }
        actionBtn.addEventListener("click", async (event) => {
          event.stopPropagation();
          actionBtn.disabled = true;
          try {
            await nodeActionController.executePrimaryAction(node, {
              state,
              nodeMap,
              isRichView: false,
              isDone: false,
            });
          } finally {
            actionBtn.disabled = false;
          }
        });
        return actionBtn;
      };

      for (const entry of entries) {
        const node = entry.node;
        const nodeEffect = getNodeEffect(node);
        const nodeView = getNodeView(node);
        const isDone = nodeEffect?.metaVariant === "done";
        const isRichView = nodeView.type !== "flow-node";
        const nodePrimaryAction = nodeActionController.resolvePrimaryAction(node, { isRichView, isDone });
        const isCandidate = nodeActionController.hasNodeCapability(node, "create-branch");
        const isNonInteractive = !nodeActionController.isNodeDirectlyInteractive(node, { isRichView, isDone });
        const isCanvasSelected = isRichView
          && String(getSelectedTaskCanvasNodeId?.() || "").trim() === String(node?.id || "").trim();
        const nodeEl = documentRef.createElement(isNonInteractive ? "div" : "button");
        if (nodeEl.type !== undefined && !isNonInteractive) {
          nodeEl.type = "button";
        }
        nodeEl.className = "quest-task-flow-node";
        if (isRichView) nodeEl.classList.add("is-rich-view", `is-view-${nodeView.type}`);
        if (isRichView) nodeEl.classList.add("is-canvas-selectable");
        if (isCanvasSelected) nodeEl.classList.add("is-canvas-selected");
        if (!node.parentNodeId) nodeEl.classList.add("is-root");
        if (isCandidate) nodeEl.classList.add("is-candidate");
        if (isDone) nodeEl.classList.add("is-done");
        if (node.isCurrentPath) nodeEl.classList.add("is-current-path");
        if (node.isCurrent) nodeEl.classList.add("is-current");
        if (node.status === "parked") nodeEl.classList.add("is-parked");
        if (node.status === "resolved") nodeEl.classList.add("is-resolved");
        if (node.status === "merged") nodeEl.classList.add("is-resolved", "is-merged");
        nodeEl.style.left = `${entry.x}px`;
        nodeEl.style.top = `${entry.y}px`;
        nodeEl.style.width = `${entry.nodeWidth}px`;
        nodeEl.style.minHeight = `${entry.nodeHeight}px`;

        const badge = documentRef.createElement("div");
        badge.className = "quest-task-flow-node-badge";
        if (node.status === "parked") badge.classList.add("is-parked");
        if (node.status === "resolved") badge.classList.add("is-complete");
        if (node.status === "merged") badge.classList.add("is-complete", "is-merged");
        badge.textContent = getProjectedTaskFlowNodeMeta(node);
        nodeEl.appendChild(badge);

        const titleEl = documentRef.createElement("div");
        titleEl.className = "quest-task-flow-node-title";
        titleEl.textContent = clipText(node.title || "当前任务", getNodeLayoutVariant(node) === "compact" ? 22 : 28);
        titleEl.title = String(node.title || "").trim();
        nodeEl.appendChild(titleEl);

        const summary = isRichView
          ? (getProjectedTaskFlowNodeSummary(node, activeQuest) || getNodeViewLabel(nodeView))
          : getProjectedTaskFlowNodeSummary(node, activeQuest);
        if (summary) {
          const summaryEl = documentRef.createElement("div");
          summaryEl.className = "quest-task-flow-node-summary";
          summaryEl.textContent = summary;
          summaryEl.title = summary;
          nodeEl.appendChild(summaryEl);
        }

        if (nodePrimaryAction === "create-branch") {
          nodeEl.appendChild(createCandidateAction(node));
        } else if (nodePrimaryAction === "open-session" && !isDone && node.sessionId) {
          nodeEl.addEventListener("click", () => {
            void nodeActionController.executePrimaryAction(node, {
              state,
              nodeMap,
              isRichView,
              isDone,
            });
          });
        } else if (isRichView && typeof selectTaskCanvasNode === "function") {
          nodeEl.addEventListener("click", () => {
            selectTaskCanvasNode(node?.id || "", { render: true });
          });
        }

        canvas.appendChild(nodeEl);
      }

      scroll.appendChild(canvas);
      board.appendChild(scroll);

      const focusEntries = entries.filter((entry) => entry?.node && (entry.node.isCurrent || entry.node.isCurrentPath || !entry.node.parentNodeId));
      const focusEntry = focusEntries[0] || entries.find((entry) => entry?.node?.isCurrent) || entries.find((entry) => entry?.node?.isCurrentPath) || entries[0];
      const focusBounds = focusEntries.length > 0
        ? focusEntries.reduce((acc, entry) => ({
          left: Math.min(acc.left, entry.x),
          right: Math.max(acc.right, entry.x + entry.nodeWidth),
          top: Math.min(acc.top, entry.y),
          bottom: Math.max(acc.bottom, entry.y + entry.nodeHeight),
        }), {
          left: Number.POSITIVE_INFINITY,
          right: Number.NEGATIVE_INFINITY,
          top: Number.POSITIVE_INFINITY,
          bottom: Number.NEGATIVE_INFINITY,
        })
        : null;
      const focusCenterX = focusBounds
        ? ((focusBounds.left + focusBounds.right) / 2)
        : (focusEntry ? (focusEntry.x + focusEntry.nodeWidth / 2) : (tree.x + tree.nodeWidth / 2));
      const focusCenterY = focusBounds
        ? ((focusBounds.top + focusBounds.bottom) / 2)
        : (focusEntry ? (focusEntry.y + focusEntry.nodeHeight / 2) : (tree.y + tree.nodeHeight / 2));
      const scheduleScrollSync = typeof windowRef?.setTimeout === "function"
        ? windowRef.setTimeout.bind(windowRef)
        : (typeof globalThis?.setTimeout === "function" ? globalThis.setTimeout.bind(globalThis) : ((fn) => fn()));
      scheduleScrollSync(() => {
        initializeTaskFlowCanvasViewport({
          scroll,
          canvas,
          svg,
          focusCenterX,
          focusCenterY,
          focusTopY: focusBounds?.top ?? (focusEntry ? focusEntry.y : tree.y),
          contentWidth: canvasWidth,
          contentHeight: canvasHeight,
          metrics,
        });
      }, 0);

      if (entries.length <= 1) {
        const emptyState = documentRef.createElement("div");
        emptyState.className = "task-map-empty";
        const emptyLabel = translate("taskMap.empty");
        emptyState.textContent = emptyLabel && emptyLabel !== "taskMap.empty"
          ? emptyLabel
          : "暂无支线，后续任务流程会显示在这里。";
        board.appendChild(emptyState);
      }

      return board;
    }

    return { renderFlowBoard };
  }

  window.MelodySyncTaskMapUi = Object.freeze({
    createRenderer,
  });
})();
