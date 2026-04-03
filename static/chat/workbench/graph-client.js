(function workbenchGraphClientModule() {
  function trimText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function cloneJson(value) {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function getFetchJson() {
    return globalThis?.fetchJsonOrRedirect
      || globalThis?.window?.fetchJsonOrRedirect
      || null;
  }

  async function fetchTaskMapGraphForSession(sessionId = "") {
    const normalizedSessionId = trimText(sessionId);
    const fetchJson = getFetchJson();
    if (!normalizedSessionId || typeof fetchJson !== "function") return null;
    return fetchJson(`/api/workbench/sessions/${encodeURIComponent(normalizedSessionId)}/task-map-graph`);
  }

  function buildProjectionFromTaskMapGraph(taskMapGraph = null) {
    if (!taskMapGraph || typeof taskMapGraph !== "object") return null;
    const quest = cloneJson(taskMapGraph);
    const nodes = Array.isArray(quest?.nodes) ? quest.nodes : [];
    const edges = Array.isArray(quest?.edges) ? quest.edges : [];
    if (!trimText(quest?.rootSessionId) || nodes.length === 0) return null;
    const nodeById = new Map(nodes.filter((node) => trimText(node?.id)).map((node) => [trimText(node.id), node]));
    const activeNode = nodeById.get(trimText(quest?.currentNodeId))
      || nodes.find((node) => node?.isCurrent)
      || nodes[0]
      || null;
    quest.nodeIds = Array.isArray(quest?.nodeIds) && quest.nodeIds.length > 0
      ? quest.nodeIds
      : nodes.map((node) => node.id);
    quest.edgeIds = Array.isArray(quest?.edgeIds) && quest.edgeIds.length > 0
      ? quest.edgeIds
      : edges.map((edge) => edge.id);
    return {
      mainQuests: [quest],
      activeMainQuestId: trimText(quest?.id),
      activeNodeId: trimText(activeNode?.id),
      activeMainQuest: quest,
      activeNode,
    };
  }

  window.MelodySyncWorkbenchGraphClient = Object.freeze({
    fetchTaskMapGraphForSession,
    buildProjectionFromTaskMapGraph,
  });
})();
