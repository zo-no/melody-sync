import { createClientSessionDetail } from '../session/client.mjs';

export function withWorkbenchSnapshot(payload = {}, snapshot) {
  return {
    ...payload,
    snapshot,
  };
}

export function createWorkbenchSessionPayload(session, extras = {}) {
  return {
    session: createClientSessionDetail(session),
    ...extras,
  };
}

export function createWorkbenchTaskMapPlansPayload(result) {
  return {
    rootSessionId: result.rootSessionId,
    taskMapPlans: result.taskMapPlans,
  };
}

export function createWorkbenchTaskMapGraphPayload(result) {
  return {
    rootSessionId: result.rootSessionId,
    taskMapGraph: result.taskMapGraph,
  };
}

export function createWorkbenchTaskMapSurfacePayload(result) {
  return {
    rootSessionId: result.rootSessionId,
    surfaceSlot: result.surfaceSlot,
    surfaceNodes: result.surfaceNodes,
    entries: result.entries,
  };
}
