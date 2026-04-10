(function workbenchNodeCapabilitiesModule() {
  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function getNodeEffectsApi() {
    return globalThis?.MelodySyncWorkbenchNodeEffects
      || globalThis?.window?.MelodySyncWorkbenchNodeEffects
      || null;
  }

  function getNodeInstanceApi() {
    return globalThis?.MelodySyncWorkbenchNodeInstance
      || globalThis?.window?.MelodySyncWorkbenchNodeInstance
      || null;
  }

  function getNodeCapabilities(node) {
    return getNodeEffectsApi()?.getNodeCapabilities?.(node) || [];
  }

  function hasNodeCapability(node, capability) {
    const normalizedCapability = trimText(capability).toLowerCase();
    if (!normalizedCapability) return false;
    return getNodeCapabilities(node).includes(normalizedCapability);
  }

  function normalizeNodeStatus(value) {
    return trimText(value).toLowerCase();
  }

  function isClosedNodeStatus(status) {
    return ["resolved", "merged", "done", "closed"].includes(normalizeNodeStatus(status));
  }

  function isSessionBackedNode(node) {
    return getNodeEffectsApi()?.getNodeEffect?.(node)?.countsAs?.sessionNode === true
      || Boolean(trimText(node?.sessionId || node?.sourceSessionId));
  }

  function getGraphOpsUi() {
    return globalThis?.MelodySyncGraphOpsUi
      || globalThis?.window?.MelodySyncGraphOpsUi
      || null;
  }

  function resolvePrimaryAction(node, { isRichView = false, isDone = false } = {}) {
    if (!node || isRichView || isDone) return "none";
    if (hasNodeCapability(node, "create-branch")) return "create-branch";
    if (hasNodeCapability(node, "open-session") && trimText(node.sessionId)) return "open-session";
    return "none";
  }

  function isNodeDirectlyInteractive(node, options = {}) {
    return resolvePrimaryAction(node, options) === "open-session";
  }

  function buildBranchCreationPayload(node, nodeMap = new Map()) {
    const parentTitle = trimText(
      node?.parentNodeId && typeof nodeMap?.get === "function"
        ? nodeMap.get(node.parentNodeId)?.title
        : "",
    );
    return {
      branchReason: parentTitle
        ? `从「${parentTitle}」继续展开关联任务`
        : "从当前任务继续展开关联任务",
      checkpointSummary: trimText(node?.title),
    };
  }

  function buildManualBranchCreationPayload(node) {
    const sourceTitle = trimText(node?.title) || "当前任务";
    return {
      branchReason: `从「${sourceTitle}」继续展开关联任务`,
      checkpointSummary: sourceTitle,
    };
  }

  function canCreateManualBranch(node, { isRichView = false, isDone = false } = {}) {
    if (!node || isDone || isRichView) return false;
    if (!isSessionBackedNode(node)) return false;
    return !isClosedNodeStatus(node?.status);
  }

  function canReparentSession(node, { isRichView = false, isDone = false } = {}) {
    if (!node || isDone || isRichView) return false;
    if (!isSessionBackedNode(node)) return false;
    return !isClosedNodeStatus(node?.status);
  }

  function canConnectSession(node, { isRichView = false, isDone = false } = {}) {
    if (!node || isDone || isRichView) return false;
    if (!isSessionBackedNode(node)) return false;
    return !isClosedNodeStatus(node?.status);
  }

  function createController({
    collapseTaskMapAfterAction = null,
    enterBranchFromSession = null,
    getSessionRecord = null,
    attachSession = null,
    reparentSession = null,
    connectSessions = null,
    getCurrentSessionId = () => "",
  } = {}) {
    async function executeCreateBranch(node, { nodeMap = new Map() } = {}) {
      const sourceSessionId = getNodeInstanceApi()?.resolveNodeSourceSessionId?.(node)
        || trimText(node?.sourceSessionId || node?.sessionId);
      if (!sourceSessionId || typeof enterBranchFromSession !== "function") return false;
      collapseTaskMapAfterAction?.({ render: false });
      await enterBranchFromSession(sourceSessionId, node.title, buildBranchCreationPayload(node, nodeMap));
      return true;
    }

    async function executeManualBranch(node, branchTitle, {
      nodeMap = new Map(),
      branchReason = "",
      checkpointSummary = "",
    } = {}) {
      const sourceSessionId = getNodeInstanceApi()?.resolveNodeSourceSessionId?.(node)
        || trimText(node?.sourceSessionId || node?.sessionId);
      const normalizedTitle = trimText(branchTitle);
      if (!sourceSessionId || !normalizedTitle || typeof enterBranchFromSession !== "function") return false;
      const payload = buildManualBranchCreationPayload(node, nodeMap);
      collapseTaskMapAfterAction?.({ render: false });
      await enterBranchFromSession(sourceSessionId, normalizedTitle, {
        branchReason: trimText(branchReason) || payload.branchReason,
        checkpointSummary: trimText(checkpointSummary) || payload.checkpointSummary,
      });
      return true;
    }

    function executeOpenSession(node, { state = null } = {}) {
      const sessionId = trimText(node?.sessionId);
      if (!sessionId || typeof attachSession !== "function") return false;
      const sessionRecord = getSessionRecord?.(sessionId)
        || state?.parentSession
        || state?.cluster?.mainSession
        || null;
      collapseTaskMapAfterAction?.({ render: false });
      attachSession(sessionId, sessionRecord);
      return true;
    }

    async function executePrimaryAction(node, context = {}) {
      const action = resolvePrimaryAction(node, context);
      if (action === "create-branch") {
        return executeCreateBranch(node, context);
      }
      if (action === "open-session") {
        return executeOpenSession(node, context);
      }
      return false;
    }

    async function executeReparentSession(node, targetSessionId = "", context = {}) {
      const sourceSessionId = getNodeInstanceApi()?.resolveNodeSourceSessionId?.(node)
        || trimText(node?.sourceSessionId || node?.sessionId);
      if (!sourceSessionId || typeof reparentSession !== "function") return false;
      await reparentSession(sourceSessionId, {
        targetSessionId: trimText(targetSessionId),
        branchReason: trimText(context?.branchReason),
      });
      return true;
    }

    async function executeConnectSession(node, targetSessionId = "", context = {}) {
      const sourceSessionId = getNodeInstanceApi()?.resolveNodeSourceSessionId?.(node)
        || trimText(node?.sourceSessionId || node?.sessionId);
      const normalizedTargetSessionId = trimText(targetSessionId);
      if (!sourceSessionId || !normalizedTargetSessionId || typeof connectSessions !== "function") return false;
      await connectSessions(sourceSessionId, {
        targetSessionId: normalizedTargetSessionId,
        graphEdgeType: trimText(context?.graphEdgeType) || "related",
      });
      return true;
    }

    async function executeGraphProposal(proposal, { sessionId = "" } = {}) {
      const normalizedSessionId = trimText(sessionId) || trimText(getCurrentSessionId?.() || "");
      if (!normalizedSessionId || !proposal?.graphOps) return false;
      const graphOpsUi = getGraphOpsUi();
      if (typeof graphOpsUi?.applyProposal !== "function") return false;
      await graphOpsUi.applyProposal({
        sessionId: normalizedSessionId,
        sourceSeq: proposal?.sourceSeq,
        graphOps: proposal.graphOps,
      });
      return true;
    }

    return Object.freeze({
      getNodeCapabilities,
      hasNodeCapability,
      resolvePrimaryAction,
      isNodeDirectlyInteractive,
      buildBranchCreationPayload,
      buildManualBranchCreationPayload,
      canCreateManualBranch,
      canReparentSession,
      canConnectSession,
      executeManualBranch,
      executeReparentSession,
      executeConnectSession,
      executeGraphProposal,
      executePrimaryAction,
    });
  }

  const api = Object.freeze({
    getNodeCapabilities,
    hasNodeCapability,
    resolvePrimaryAction,
    isNodeDirectlyInteractive,
    buildBranchCreationPayload,
    buildManualBranchCreationPayload,
    canCreateManualBranch,
    canReparentSession,
    canConnectSession,
    createController,
  });

  window.MelodySyncWorkbenchNodeCapabilities = api;
})();
