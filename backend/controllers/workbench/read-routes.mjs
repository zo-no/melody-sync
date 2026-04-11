import {
  buildWorkbenchSnapshotResponse,
  buildWorkbenchTaskMapGraphResponse,
  buildWorkbenchTaskMapPlansResponse,
  buildWorkbenchTaskMapSurfaceResponse,
} from '../../services/workbench/http-service.mjs';
import {
  getWorkbenchSnapshot,
  getWorkbenchTrackerSnapshot,
} from '../../workbench/continuity-store.mjs';
import { getWorkbenchOutputMetrics } from '../../workbench/output-metrics-service.mjs';
import { listWorkbenchMemoryCandidatesForSession } from '../../workbench/memory-candidate-store.mjs';
import { createWorkbenchNodeDefinitionsPayload } from '../../workbench/node-definitions.mjs';
import { createTaskMapPlanContractPayload } from '../../workbench/task-map-plan-contract.mjs';
import { listTaskMapPlansForSession } from '../../workbench/task-map-plan-service.mjs';
import { getTaskMapGraphForSession } from '../../workbench/task-map-graph-service.mjs';
import { getTaskMapSurfaceForSession } from '../../workbench/task-map-surface-service.mjs';

export async function handleWorkbenchReadRoutes(ctx) {
  const { req, res, pathname, pathParts: parts, authSession, requireSessionAccess, writeJson } = ctx;
  if (pathname === '/api/workbench/node-definitions' && req?.method === 'GET') {
    writeJson(res, 200, createWorkbenchNodeDefinitionsPayload());
    return true;
  }

  if (pathname === '/api/workbench/task-map-plan-contract' && req?.method === 'GET') {
    writeJson(res, 200, createTaskMapPlanContractPayload());
    return true;
  }

  if (pathname === '/api/workbench' && req?.method === 'GET') {
    writeJson(res, 200, await getWorkbenchSnapshot());
    return true;
  }

  if (pathname === '/api/workbench/output-metrics' && req?.method === 'GET') {
    writeJson(res, 200, getWorkbenchOutputMetrics());
    return true;
  }

  if (!(pathname.startsWith('/api/workbench/') && req?.method === 'GET')) {
    return false;
  }


  if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'tracker') {
    const sessionId = parts[3];
    if (!requireSessionAccess(res, authSession, sessionId)) return true;
    writeJson(res, 200, await getWorkbenchTrackerSnapshot(sessionId));
    return true;
  }

  if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'memory-candidates') {
    const sessionId = parts[3];
    if (!requireSessionAccess(res, authSession, sessionId)) return true;
    const memoryCandidates = await listWorkbenchMemoryCandidatesForSession(sessionId);
    writeJson(res, 200, await buildWorkbenchSnapshotResponse({ memoryCandidates }));
    return true;
  }

  if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'task-map-plans') {
    const sessionId = parts[3];
    if (!requireSessionAccess(res, authSession, sessionId)) return true;
    try {
      const result = await listTaskMapPlansForSession(sessionId);
      writeJson(res, 200, buildWorkbenchTaskMapPlansResponse(result));
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to list task-map plans' });
    }
    return true;
  }

  if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'task-map-graph') {
    const sessionId = parts[3];
    if (!requireSessionAccess(res, authSession, sessionId)) return true;
    try {
      const result = await getTaskMapGraphForSession(sessionId);
      writeJson(res, 200, buildWorkbenchTaskMapGraphResponse(result));
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to build task-map graph' });
    }
    return true;
  }

  if (parts.length === 6 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'task-map-surfaces') {
    const sessionId = parts[3];
    const surfaceSlot = decodeURIComponent(parts[5]);
    if (!requireSessionAccess(res, authSession, sessionId)) return true;
    try {
      const result = await getTaskMapSurfaceForSession(sessionId, surfaceSlot);
      writeJson(res, 200, buildWorkbenchTaskMapSurfaceResponse(result));
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to build task-map surface' });
    }
    return true;
  }

  return false;
}
