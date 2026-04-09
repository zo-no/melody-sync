import { getWorkbenchSnapshot } from '../../workbench/index.mjs';
import {
  createWorkbenchSessionPayload,
  createWorkbenchTaskMapGraphPayload,
  createWorkbenchTaskMapPlansPayload,
  createWorkbenchTaskMapSurfacePayload,
  withWorkbenchSnapshot,
} from '../../views/workbench/http.mjs';

export async function buildWorkbenchSnapshotResponse(payload = {}) {
  return withWorkbenchSnapshot(payload, await getWorkbenchSnapshot());
}

export function buildWorkbenchTaskMapPlansResponse(result) {
  return createWorkbenchTaskMapPlansPayload(result);
}

export function buildWorkbenchTaskMapGraphResponse(result) {
  return createWorkbenchTaskMapGraphPayload(result);
}

export function buildWorkbenchTaskMapSurfaceResponse(result) {
  return createWorkbenchTaskMapSurfacePayload(result);
}

export async function buildWorkbenchTaskMapPlansMutationResponse(result, extras = {}) {
  return buildWorkbenchSnapshotResponse({
    ...createWorkbenchTaskMapPlansPayload(result),
    ...extras,
  });
}

export async function buildWorkbenchSessionMutationResponse(session, extras = {}, options = {}) {
  const payload = createWorkbenchSessionPayload(session, extras);
  if (options.includeSnapshot === false) {
    return payload;
  }
  return withWorkbenchSnapshot(payload, options.snapshot ?? await getWorkbenchSnapshot());
}
