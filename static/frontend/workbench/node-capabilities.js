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
        ? `从「${parentTitle}」继续拆出独立支线`
        : "从当前任务拆出独立支线",
      checkpointSummary: trimText(node?.title),
    };
  }

  function buildManualBranchCreationPayload(node) {
    const sourceTitle = trimText(node?.title) || "当前任务";
    return {
      branchReason: `从「${sourceTitle}」继续拆出独立支线`,
      checkpointSummary: sourceTitle,
    };
  }

  function canCreateManualBranch(node, { isRichView = false, isDone = false } = {}) {
    if (!node || isDone || isRichView) return false;
    if (!isSessionBackedNode(node)) return false;
    return !isClosedNodeStatus(node?.status);
  }

  function createController({
    collapseTaskMapAfterAction = null,
    enterBranchFromSession = null,
    getSessionRecord = null,
    attachSession = null,
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

    return Object.freeze({
      getNodeCapabilities,
      hasNodeCapability,
      resolvePrimaryAction,
      isNodeDirectlyInteractive,
      buildBranchCreationPayload,
      buildManualBranchCreationPayload,
      canCreateManualBranch,
      executeManualBranch,
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
    createController,
  });

  window.MelodySyncWorkbenchNodeCapabilities = api;
})();
