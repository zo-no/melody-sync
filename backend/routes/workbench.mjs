import { readBody } from '../../lib/utils.mjs';
import { applySessionGraphOps } from '../session/manager.mjs';
import {
  buildWorkbenchSessionMutationResponse,
  buildWorkbenchSnapshotResponse,
  buildWorkbenchTaskMapGraphResponse,
  buildWorkbenchTaskMapPlansMutationResponse,
  buildWorkbenchTaskMapPlansResponse,
  buildWorkbenchTaskMapSurfaceResponse,
} from '../services/workbench/http-service.mjs';
import {
  createWorkbenchNodeDefinitionResponse,
  deleteWorkbenchNodeDefinitionResponse,
  getWorkbenchNodeDefinitionsResponse,
  updateWorkbenchNodeDefinitionResponse,
} from '../services/workbench/node-definitions-http-service.mjs';
import { createTaskMapPlanContractPayload } from '../workbench/task-map-plan-contract.mjs';
import {
  deleteTaskMapPlanForSession,
  listTaskMapPlansForSession,
  saveTaskMapPlanForSession,
} from '../workbench/task-map-plan-service.mjs';
import { getTaskMapGraphForSession } from '../workbench/task-map-graph-service.mjs';
import { getTaskMapSurfaceForSession } from '../workbench/task-map-surface-service.mjs';
import {
  createBranchFromSession,
  createBranchFromNode,
  createCaptureItem,
  createNode as createWorkbenchNode,
  createProject as createWorkbenchProject,
  createProjectSummary,
  getSessionOperationRecords,
  getWorkbenchSnapshot,
  getWorkbenchTrackerSnapshot,
  mergeBranchSessionBackToMain,
  promoteCaptureItem,
  reparentSession,
  setBranchCandidateSuppressed,
  setBranchSessionStatus,
  setSessionReminderSnooze,
  writeProjectToObsidian,
} from '../workbench/index.mjs';

async function readJsonBody(req, maxBytes = 65536) {
  const raw = await readBody(req, maxBytes);
  return raw ? JSON.parse(raw) : {};
}

export async function handleWorkbenchRoutes({
  req,
  res,
  pathname,
  authSession,
  requireSessionAccess,
  writeJson,
} = {}) {
  // Legacy alias. The owner-facing settings surface now reads /api/settings/nodes.
  if (pathname === '/api/workbench/node-definitions' && req?.method === 'GET') {
    writeJson(res, 200, getWorkbenchNodeDefinitionsResponse());
    return true;
  }

  if (pathname === '/api/workbench/task-map-plan-contract' && req?.method === 'GET') {
    writeJson(res, 200, createTaskMapPlanContractPayload());
    return true;
  }

  if (pathname === '/api/workbench' && req?.method === 'GET') {
    const snapshot = await getWorkbenchSnapshot();
    writeJson(res, 200, snapshot);
    return true;
  }

  // Legacy alias. The owner-facing settings surface now writes /api/settings/nodes.
  if (pathname === '/api/workbench/node-definitions' && req?.method === 'POST') {
    let payload = {};
    try {
      payload = await readJsonBody(req, 16384);
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    try {
      writeJson(res, 201, await createWorkbenchNodeDefinitionResponse(payload));
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to create custom node kind' });
    }
    return true;
  }

  // Legacy alias. The owner-facing settings surface now writes /api/settings/nodes/:id.
  if (pathname.startsWith('/api/workbench/node-definitions/') && req?.method === 'PATCH') {
    const nodeKindId = decodeURIComponent(pathname.slice('/api/workbench/node-definitions/'.length));
    let payload = {};
    try {
      payload = await readJsonBody(req, 16384);
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    try {
      writeJson(res, 200, await updateWorkbenchNodeDefinitionResponse(nodeKindId, payload));
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to update custom node kind' });
    }
    return true;
  }

  // Legacy alias. The owner-facing settings surface now writes /api/settings/nodes/:id.
  if (pathname.startsWith('/api/workbench/node-definitions/') && req?.method === 'DELETE') {
    const nodeKindId = decodeURIComponent(pathname.slice('/api/workbench/node-definitions/'.length));
    try {
      writeJson(res, 200, await deleteWorkbenchNodeDefinitionResponse(nodeKindId));
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to delete custom node kind' });
    }
    return true;
  }

  if (pathname.startsWith('/api/workbench/') && req?.method === 'GET') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'tracker') {
      const sessionId = parts[3];
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      const trackerSnapshot = await getWorkbenchTrackerSnapshot(sessionId);
      writeJson(res, 200, trackerSnapshot);
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'operation-record') {
      const sessionId = parts[3];
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      try {
        const result = await getSessionOperationRecords(sessionId);
        writeJson(res, 200, result);
      } catch (error) {
        writeJson(res, 400, { error: error.message || 'Failed to build operation record' });
      }
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

  if (pathname.startsWith('/api/workbench/') && req?.method === 'DELETE') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 6 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'task-map-plans') {
      const sessionId = parts[3];
      const planId = decodeURIComponent(parts[5]);
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      try {
        const result = await deleteTaskMapPlanForSession(sessionId, planId);
        writeJson(res, 200, await buildWorkbenchTaskMapPlansMutationResponse(result, {
          deletedPlanId: result.deletedPlanId,
          taskCardUpdates: result.taskCardUpdates,
        }));
      } catch (error) {
        writeJson(res, 400, { error: error.message || 'Failed to delete task-map plan' });
      }
      return true;
    }
    return false;
  }

  if (!(pathname.startsWith('/api/workbench/') && req?.method === 'POST')) {
    return false;
  }

  const parts = pathname.split('/').filter(Boolean);
  let payload = {};
  try {
    payload = await readJsonBody(req, 65536);
  } catch {
    writeJson(res, 400, { error: 'Invalid request body' });
    return true;
  }

  try {
    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'captures') {
      const captureItem = await createCaptureItem(payload);
      writeJson(res, 201, await buildWorkbenchSnapshotResponse({
        captureItem,
      }));
      return true;
    }

    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'projects') {
      const project = await createWorkbenchProject(payload);
      writeJson(res, 201, await buildWorkbenchSnapshotResponse({
        project,
      }));
      return true;
    }

    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'nodes') {
      const node = await createWorkbenchNode(payload);
      writeJson(res, 201, await buildWorkbenchSnapshotResponse({
        node,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'captures' && parts[4] === 'promote') {
      const captureId = parts[3];
      const outcome = await promoteCaptureItem(captureId, payload);
      writeJson(res, 201, await buildWorkbenchSnapshotResponse({
        ...outcome,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'nodes' && parts[4] === 'branch') {
      const nodeId = parts[3];
      const outcome = await createBranchFromNode(nodeId, payload);
      writeJson(res, 201, await buildWorkbenchSessionMutationResponse(outcome.session, {
        branchContext: outcome.branchContext,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'branches') {
      const sessionId = parts[3];
      const outcome = await createBranchFromSession(sessionId, payload);
      writeJson(res, 201, await buildWorkbenchSessionMutationResponse(outcome.session, {
        branchContext: outcome.branchContext,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'reparent') {
      const sessionId = parts[3];
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      const targetSessionId = typeof payload?.targetSessionId === 'string' ? payload.targetSessionId.trim() : '';
      if (targetSessionId && !requireSessionAccess(res, authSession, targetSessionId)) return true;
      const outcome = await reparentSession(sessionId, payload);
      writeJson(res, 200, await buildWorkbenchSessionMutationResponse(outcome.session, {
        branchContext: outcome.branchContext,
      }, {
        snapshot: outcome.snapshot || undefined,
      }));
      return true;
    }

    if (parts.length === 6 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'graph-ops' && parts[5] === 'apply') {
      const sessionId = parts[3];
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      const graphOps = payload?.graphOps && typeof payload.graphOps === 'object'
        ? payload.graphOps
        : payload;
      const outcome = await applySessionGraphOps(sessionId, graphOps);
      writeJson(res, 200, {
        ok: true,
        appliedCount: outcome?.appliedCount || 0,
        historyChanged: outcome?.historyChanged === true,
        sessionChanged: outcome?.sessionChanged === true,
        snapshot: await getWorkbenchSnapshot(),
      });
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'task-map-plans') {
      const sessionId = parts[3];
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      const result = await saveTaskMapPlanForSession(sessionId, payload);
      writeJson(res, 201, await buildWorkbenchTaskMapPlansMutationResponse(result, {
        taskMapPlan: result.taskMapPlan,
        taskCardUpdates: result.taskCardUpdates,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'candidate-suppression') {
      const sessionId = parts[3];
      const branchTitle = typeof payload?.branchTitle === 'string' ? payload.branchTitle.trim() : '';
      if (!branchTitle) {
        writeJson(res, 400, { error: 'branchTitle is required' });
        return true;
      }
      const outcome = await setBranchCandidateSuppressed(sessionId, branchTitle, payload?.suppressed !== false);
      writeJson(res, 200, await buildWorkbenchSessionMutationResponse(outcome.session));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'branch-status') {
      const sessionId = parts[3];
      const outcome = await setBranchSessionStatus(sessionId, payload);
      writeJson(res, 200, await buildWorkbenchSessionMutationResponse(outcome.session, {
        branchContext: outcome.branchContext,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'reminder') {
      const sessionId = parts[3];
      const reminder = await setSessionReminderSnooze(sessionId, payload);
      writeJson(res, 200, await buildWorkbenchSnapshotResponse({
        reminder,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'merge-return') {
      const sessionId = parts[3];
      const outcome = await mergeBranchSessionBackToMain(sessionId, payload);
      writeJson(res, 200, await buildWorkbenchSessionMutationResponse(outcome.parentSession, {
        mergeNote: outcome.mergeNote,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'projects' && parts[4] === 'summaries') {
      const projectId = parts[3];
      const summary = await createProjectSummary(projectId);
      writeJson(res, 201, await buildWorkbenchSnapshotResponse({
        summary,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'projects' && parts[4] === 'writeback') {
      const projectId = parts[3];
      const outcome = await writeProjectToObsidian(projectId, payload);
      writeJson(res, 200, await buildWorkbenchSnapshotResponse({
        ...outcome,
      }));
      return true;
    }
  } catch (error) {
    writeJson(res, 400, { error: error.message || 'Workbench request failed' });
    return true;
  }

  writeJson(res, 404, { error: 'Workbench route not found' });
  return true;
}
