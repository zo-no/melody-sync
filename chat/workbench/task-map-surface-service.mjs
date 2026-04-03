import {
  buildComposerSuggestionEntry,
  hasSurfaceBinding,
} from './node-instance.mjs';
import { getTaskMapGraphForSession } from './task-map-graph-service.mjs';
import { trimText } from './shared.mjs';

function resolveSurfaceSourceSessionId(session = null) {
  return trimText(session?.id);
}

function resolveNodeSourceSessionIds(node = {}) {
  return [
    trimText(node?.sourceSessionId),
    trimText(node?.sessionId),
  ].filter(Boolean);
}

function collectTaskMapSurfaceNodes({
  taskMapGraph = null,
  session = null,
  surfaceSlot = '',
} = {}) {
  const normalizedSurfaceSlot = trimText(surfaceSlot).toLowerCase();
  if (!taskMapGraph || typeof taskMapGraph !== 'object' || !normalizedSurfaceSlot) return [];
  const sourceSessionId = resolveSurfaceSourceSessionId(session);
  return (Array.isArray(taskMapGraph.nodes) ? taskMapGraph.nodes : []).filter((node) => {
    if (!hasSurfaceBinding(node, normalizedSurfaceSlot)) return false;
    if (!sourceSessionId) return true;
    const candidateSourceSessionIds = resolveNodeSourceSessionIds(node);
    return candidateSourceSessionIds.includes(sourceSessionId);
  });
}

export async function getTaskMapSurfaceForSession(sessionId = '', surfaceSlot = '') {
  const graphResult = await getTaskMapGraphForSession(sessionId);
  const normalizedSurfaceSlot = trimText(surfaceSlot).toLowerCase();
  const surfaceNodes = collectTaskMapSurfaceNodes({
    taskMapGraph: graphResult.taskMapGraph,
    session: graphResult.session,
    surfaceSlot: normalizedSurfaceSlot,
  });
  return {
    session: graphResult.session,
    rootSessionId: graphResult.rootSessionId,
    surfaceSlot: normalizedSurfaceSlot,
    taskMapGraph: graphResult.taskMapGraph,
    surfaceNodes,
    entries: normalizedSurfaceSlot === 'composer-suggestions'
      ? surfaceNodes.map((node) => buildComposerSuggestionEntry(node)).filter(Boolean)
      : [],
  };
}

export {
  collectTaskMapSurfaceNodes,
};
