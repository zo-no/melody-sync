import { createNodeInstance } from './node-instance.mjs';
import { getNodeKindDefinition } from './node-definitions.mjs';
import { trimText } from './shared.mjs';

function getNodeKindEffect(kind = '') {
  const definition = getNodeKindDefinition(kind);
  const composition = definition?.composition || {};
  return {
    layoutVariant: trimText(composition.layoutVariant) || 'default',
    edgeVariant: trimText(composition.defaultEdgeType) || 'structural',
    interaction: trimText(composition.defaultInteraction) || 'none',
    trackAsCandidateChild: trimText(kind).toLowerCase() === 'candidate',
    countsAs: {
      sessionNode: composition?.countsAs?.sessionNode === true,
      branch: composition?.countsAs?.branch === true,
      candidate: composition?.countsAs?.candidate === true,
      completedSummary: composition?.countsAs?.completedSummary === true,
    },
  };
}

export function createGraphNodeInstance(node = {}) {
  const nextNode = createNodeInstance(node, {
    questId: trimText(node?.questId),
    origin: node?.origin || { type: 'projection', sourceId: 'continuity' },
  });
  if (!nextNode) return null;
  return {
    ...nextNode,
    childNodeIds: Array.isArray(nextNode.childNodeIds) ? [...nextNode.childNodeIds] : [],
    candidateNodeIds: Array.isArray(nextNode.candidateNodeIds) ? [...nextNode.candidateNodeIds] : [],
    kindEffect: getNodeKindEffect(nextNode.kind),
  };
}

export function createGraphEdgeInstance(edge = {}, { questId = '' } = {}) {
  const fromNodeId = trimText(edge.fromNodeId || edge.from);
  const toNodeId = trimText(edge.toNodeId || edge.to);
  if (!fromNodeId || !toNodeId) return null;
  return {
    id: trimText(edge.id) || `edge:${fromNodeId}:${toNodeId}`,
    questId: trimText(edge.questId || questId),
    fromNodeId,
    toNodeId,
    type: trimText(edge.type) || 'structural',
  };
}

export function createQuestGraphCollections({ questId = '' } = {}) {
  return {
    questId: trimText(questId),
    nodes: [],
    nodeById: new Map(),
    edges: [],
    edgeById: new Set(),
  };
}

export function appendGraphEdge(collections, edge = {}) {
  if (!collections || typeof collections !== 'object') return null;
  const nextEdge = createGraphEdgeInstance(edge, { questId: collections.questId });
  if (!nextEdge || collections.edgeById.has(nextEdge.id)) return null;
  collections.edgeById.add(nextEdge.id);
  collections.edges.push(nextEdge);
  return nextEdge;
}

export function appendGraphNode(collections, node = {}) {
  if (!collections || typeof collections !== 'object') return null;
  const nextNode = createGraphNodeInstance(node);
  if (!nextNode?.id) return null;
  if (collections.nodeById.has(nextNode.id)) {
    return collections.nodeById.get(nextNode.id);
  }
  collections.nodes.push(nextNode);
  collections.nodeById.set(nextNode.id, nextNode);

  const parentNodeId = trimText(nextNode.parentNodeId);
  if (!parentNodeId) return nextNode;
  const parentNode = collections.nodeById.get(parentNodeId);
  if (!parentNode) return nextNode;
  if (!parentNode.childNodeIds.includes(nextNode.id)) {
    parentNode.childNodeIds.push(nextNode.id);
  }
  if (nextNode.kindEffect?.trackAsCandidateChild === true && !parentNode.candidateNodeIds.includes(nextNode.id)) {
    parentNode.candidateNodeIds.push(nextNode.id);
  }
  appendGraphEdge(collections, {
    id: `edge:${parentNode.id}:${nextNode.id}`,
    fromNodeId: parentNode.id,
    toNodeId: nextNode.id,
    type: nextNode.kindEffect?.edgeVariant || 'structural',
  });
  return nextNode;
}

export function hydrateQuestGraphCollections({ questId = '', nodes = [], edges = [] } = {}) {
  const collections = createQuestGraphCollections({ questId });
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const nextNode = createGraphNodeInstance(node);
    if (!nextNode?.id || collections.nodeById.has(nextNode.id)) continue;
    collections.nodes.push(nextNode);
    collections.nodeById.set(nextNode.id, nextNode);
  }
  for (const edge of Array.isArray(edges) ? edges : []) {
    appendGraphEdge(collections, edge);
  }
  return collections;
}

export function buildQuestNodeCounts(nodes = []) {
  const realNodes = (Array.isArray(nodes) ? nodes : []).filter((node) => node?.kindEffect?.countsAs?.sessionNode === true);
  const branchNodes = realNodes.filter((node) => node?.kindEffect?.countsAs?.branch === true);
  const candidateNodes = (Array.isArray(nodes) ? nodes : []).filter((node) => node?.kindEffect?.countsAs?.candidate === true);
  return {
    sessionNodes: realNodes.length,
    activeBranches: branchNodes.filter((node) => node.status === 'active').length,
    parkedBranches: branchNodes.filter((node) => node.status === 'parked').length,
    completedBranches: branchNodes.filter((node) => ['resolved', 'merged'].includes(node.status)).length,
    candidateBranches: candidateNodes.length,
  };
}

export function buildQuestGraphSnapshot({
  collections = null,
  questId = '',
  rootSessionId = '',
  title = '',
  summary = '',
  currentNodeId = '',
  currentNodeTitle = '',
  currentPathNodeIds = [],
} = {}) {
  const nodes = Array.isArray(collections?.nodes) ? collections.nodes : [];
  const edges = Array.isArray(collections?.edges) ? collections.edges : [];
  const nodeById = collections?.nodeById instanceof Map
    ? collections.nodeById
    : new Map(nodes.filter((node) => node?.id).map((node) => [node.id, node]));
  const resolvedRootSessionId = trimText(rootSessionId);
  const rootNodeId = resolvedRootSessionId ? `session:${resolvedRootSessionId}` : '';
  const activeNode = nodeById.get(trimText(currentNodeId)) || nodeById.get(rootNodeId) || nodes[0] || null;
  return {
    id: trimText(questId) || trimText(collections?.questId) || `quest:${resolvedRootSessionId}`,
    rootSessionId: resolvedRootSessionId,
    title: trimText(title) || trimText(activeNode?.title) || '当前任务',
    summary: trimText(summary),
    currentNodeId: trimText(activeNode?.id),
    currentNodeTitle: trimText(currentNodeTitle) || trimText(activeNode?.title) || '当前任务',
    currentPathNodeIds: Array.isArray(currentPathNodeIds) ? currentPathNodeIds.map((value) => trimText(value)).filter(Boolean) : [],
    nodeIds: nodes.map((node) => node.id),
    edgeIds: edges.map((edge) => edge.id),
    nodes,
    edges,
    counts: buildQuestNodeCounts(nodes),
  };
}
