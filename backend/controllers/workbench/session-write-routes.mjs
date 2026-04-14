import {
  buildWorkbenchSessionMutationResponse,
  buildWorkbenchSnapshotResponse,
  buildWorkbenchTaskMapPlansMutationResponse,
} from '../../services/workbench/http-service.mjs';
import {
  applyWorkbenchSessionGraphOpsForWrite,
  createWorkbenchNodeBranchForWrite,
  createWorkbenchSessionBranchForWrite,
  deleteWorkbenchTaskMapPlanForWrite,
  handoffWorkbenchSessionForWrite,
  mergeWorkbenchBranchReturnForWrite,
  reparentWorkbenchSessionForWrite,
  saveWorkbenchTaskMapPlanForWrite,
  setWorkbenchBranchSessionStatusForWrite,
  setWorkbenchCandidateSuppressionForWrite,
  updateWorkbenchMemoryCandidateStatusForWrite,
  setWorkbenchSessionReminderForWrite,
} from '../../services/workbench/write-service.mjs';
import { normalizeNullableText } from '../../workbench/shared.mjs';

export async function handleWorkbenchSessionDeleteRoutes({
  parts,
  authSession,
  requireSessionAccess,
  res,
  writeJson,
}) {
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

export async function handleWorkbenchSessionWriteRoutes({
  parts,
  payload,
  authSession,
  requireSessionAccess,
  res,
  writeJson,
}) {
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
    writeJson(res, 200, await buildWorkbenchSessionMutationResponse(outcome.session));
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

  if (parts.length === 7 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'sessions' && parts[4] === 'memory-candidates' && parts[6] === 'status') {
    const sessionId = parts[3];
    const candidateId = decodeURIComponent(parts[5]);
    if (!requireSessionAccess(res, authSession, sessionId)) return true;
    const memoryCandidate = await updateWorkbenchMemoryCandidateStatusForWrite(sessionId, candidateId, payload);
    writeJson(res, 200, await buildWorkbenchSnapshotResponse({
      memoryCandidate,
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

  return false;
}
