import { readJsonRequestBody } from '../../shared/http/request-body.mjs';
import {
  buildWorkbenchSessionMutationResponse,
  buildWorkbenchSnapshotResponse,
  buildWorkbenchTaskMapPlansMutationResponse,
} from '../../services/workbench/http-service.mjs';
import {
  createWorkbenchNodeDefinitionResponse,
  deleteWorkbenchNodeDefinitionResponse,
  updateWorkbenchNodeDefinitionResponse,
} from '../../services/workbench/node-definitions-http-service.mjs';
import {
  applyWorkbenchSessionGraphOpsForWrite,
  createWorkbenchCaptureForWrite,
  createWorkbenchNodeBranchForWrite,
  createWorkbenchNodeForWrite,
  createWorkbenchProjectForWrite,
  createWorkbenchProjectSummaryForWrite,
  createWorkbenchSessionBranchForWrite,
  deleteWorkbenchTaskMapPlanForWrite,
  handoffWorkbenchSessionForWrite,
  mergeWorkbenchBranchReturnForWrite,
  promoteWorkbenchCaptureForWrite,
  reparentWorkbenchSessionForWrite,
  saveWorkbenchTaskMapPlanForWrite,
  setWorkbenchBranchSessionStatusForWrite,
  setWorkbenchCandidateSuppressionForWrite,
  setWorkbenchSessionReminderForWrite,
  writeWorkbenchProjectToObsidianForWrite,
} from '../../services/workbench/write-service.mjs';
import { normalizeNullableText } from '../../workbench/shared.mjs';

export async function handleWorkbenchWriteRoutes({
  req,
  res,
  pathname,
  authSession,
  requireSessionAccess,
  writeJson,
} = {}) {
  if (pathname === '/api/workbench/node-definitions' && req?.method === 'POST') {
    let payload = {};
    try {
      payload = await readJsonRequestBody(req, 16384);
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

  if (pathname.startsWith('/api/workbench/node-definitions/') && req?.method === 'PATCH') {
    const nodeKindId = decodeURIComponent(pathname.slice('/api/workbench/node-definitions/'.length));
    let payload = {};
    try {
      payload = await readJsonRequestBody(req, 16384);
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

  if (pathname.startsWith('/api/workbench/node-definitions/') && req?.method === 'DELETE') {
    const nodeKindId = decodeURIComponent(pathname.slice('/api/workbench/node-definitions/'.length));
    try {
      writeJson(res, 200, await deleteWorkbenchNodeDefinitionResponse(nodeKindId));
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to delete custom node kind' });
    }
    return true;
  }

  if (pathname.startsWith('/api/workbench/') && req?.method === 'DELETE') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 6 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'task-map-plans') {
      const sessionId = parts[3];
      const planId = decodeURIComponent(parts[5]);
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      try {
        const result = await deleteWorkbenchTaskMapPlanForWrite(sessionId, planId);
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
    payload = await readJsonRequestBody(req, 65536);
  } catch {
    writeJson(res, 400, { error: 'Invalid request body' });
    return true;
  }

  try {
    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'captures') {
      const captureItem = await createWorkbenchCaptureForWrite(payload);
      writeJson(res, 201, await buildWorkbenchSnapshotResponse({
        captureItem,
      }));
      return true;
    }

    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'projects') {
      const project = await createWorkbenchProjectForWrite(payload);
      writeJson(res, 201, await buildWorkbenchSnapshotResponse({
        project,
      }));
      return true;
    }

    if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'nodes') {
      const node = await createWorkbenchNodeForWrite(payload);
      writeJson(res, 201, await buildWorkbenchSnapshotResponse({
        node,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'captures' && parts[4] === 'promote') {
      const captureId = parts[3];
      const outcome = await promoteWorkbenchCaptureForWrite(captureId, payload);
      writeJson(res, 201, await buildWorkbenchSnapshotResponse({
        ...outcome,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'nodes' && parts[4] === 'branch') {
      const nodeId = parts[3];
      const sourceSessionId = normalizeNullableText(payload?.sourceSessionId);
      if (!requireSessionAccess(res, authSession, sourceSessionId)) return true;
      const outcome = await createWorkbenchNodeBranchForWrite(nodeId, payload);
      writeJson(res, 201, await buildWorkbenchSessionMutationResponse(outcome.session, {
        branchContext: outcome.branchContext,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'branches') {
      const sessionId = parts[3];
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      const outcome = await createWorkbenchSessionBranchForWrite(sessionId, payload);
      writeJson(res, 201, await buildWorkbenchSessionMutationResponse(outcome.session, {
        branchContext: outcome.branchContext,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'handoff') {
      const sessionId = parts[3];
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      const targetSessionId = typeof payload?.targetSessionId === 'string' ? payload.targetSessionId.trim() : '';
      if (!targetSessionId) {
        writeJson(res, 400, { error: 'targetSessionId is required' });
        return true;
      }
      if (!requireSessionAccess(res, authSession, targetSessionId)) return true;
      const outcome = await handoffWorkbenchSessionForWrite(sessionId, payload);
      writeJson(res, 200, await buildWorkbenchSessionMutationResponse(outcome.session, {
        handoffPacket: outcome.packet,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'reparent') {
      const sessionId = parts[3];
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      const targetSessionId = typeof payload?.targetSessionId === 'string' ? payload.targetSessionId.trim() : '';
      if (targetSessionId && !requireSessionAccess(res, authSession, targetSessionId)) return true;
      const outcome = await reparentWorkbenchSessionForWrite(sessionId, payload);
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
      writeJson(res, 200, await applyWorkbenchSessionGraphOpsForWrite(sessionId, payload));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'task-map-plans') {
      const sessionId = parts[3];
      if (!requireSessionAccess(res, authSession, sessionId)) return true;
      const result = await saveWorkbenchTaskMapPlanForWrite(sessionId, payload);
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
      const outcome = await setWorkbenchCandidateSuppressionForWrite(sessionId, payload);
      writeJson(res, 200, await buildWorkbenchSessionMutationResponse(outcome.session));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'branch-status') {
      const sessionId = parts[3];
      const outcome = await setWorkbenchBranchSessionStatusForWrite(sessionId, payload);
      writeJson(res, 200, await buildWorkbenchSessionMutationResponse(outcome.session, {
        branchContext: outcome.branchContext,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'reminder') {
      const sessionId = parts[3];
      const reminder = await setWorkbenchSessionReminderForWrite(sessionId, payload);
      writeJson(res, 200, await buildWorkbenchSnapshotResponse({
        reminder,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'merge-return') {
      const sessionId = parts[3];
      const outcome = await mergeWorkbenchBranchReturnForWrite(sessionId, payload);
      writeJson(res, 200, await buildWorkbenchSessionMutationResponse(outcome.parentSession, {
        mergeNote: outcome.mergeNote,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'projects' && parts[4] === 'summaries') {
      const projectId = parts[3];
      const summary = await createWorkbenchProjectSummaryForWrite(projectId);
      writeJson(res, 201, await buildWorkbenchSnapshotResponse({
        summary,
      }));
      return true;
    }

    if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'projects' && parts[4] === 'writeback') {
      const projectId = parts[3];
      const outcome = await writeWorkbenchProjectToObsidianForWrite(projectId, payload);
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
