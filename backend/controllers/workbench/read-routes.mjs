import {
  buildWorkbenchSnapshotResponse,
  buildWorkbenchTaskMapGraphResponse,
  buildWorkbenchTaskMapPlansResponse,
  buildWorkbenchTaskMapSurfaceResponse,
} from '../../services/workbench/http-service.mjs';
import {
  getWorkbenchOutputMetricsForRead,
  getWorkbenchSnapshotForRead,
  getWorkbenchTrackerSnapshotForRead,
} from '../../services/workbench/read-service.mjs';
import {
  getWorkbenchNodeDefinitionsResponse,
} from '../../services/workbench/node-definitions-http-service.mjs';
import { createTaskMapPlanContractPayload } from '../../workbench/task-map-plan-contract.mjs';
import { listTaskMapPlansForSession } from '../../workbench/task-map-plan-service.mjs';
import { getTaskMapGraphForSession } from '../../workbench/task-map-graph-service.mjs';
import { getTaskMapSurfaceForSession } from '../../workbench/task-map-surface-service.mjs';

export async function handleWorkbenchReadRoutes({
  req,
  res,
  pathname,
  authSession,
  requireSessionAccess,
  writeJson,
} = {}) {
  if (pathname === '/api/workbench/node-definitions' && req?.method === 'GET') {
    writeJson(res, 200, getWorkbenchNodeDefinitionsResponse());
    return true;
  }

  if (pathname === '/api/workbench/task-map-plan-contract' && req?.method === 'GET') {
    writeJson(res, 200, createTaskMapPlanContractPayload());
    return true;
  }

  if (pathname === '/api/workbench' && req?.method === 'GET') {
    const snapshot = await getWorkbenchSnapshotForRead();
    writeJson(res, 200, snapshot);
    return true;
  }

  if (pathname === '/api/workbench/output-metrics' && req?.method === 'GET') {
    const metrics = await getWorkbenchOutputMetricsForRead();
    writeJson(res, 200, metrics);
    return true;
  }

  if (!(pathname.startsWith('/api/workbench/') && req?.method === 'GET')) {
    return false;
  }

  const parts = pathname.split('/').filter(Boolean);

  if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'tracker') {
    const sessionId = parts[3];
    if (!requireSessionAccess(res, authSession, sessionId)) return true;
    const trackerSnapshot = await getWorkbenchTrackerSnapshotForRead(sessionId);
    writeJson(res, 200, trackerSnapshot);
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
