import { applySessionGraphOps } from '../../session/manager.mjs';
import { getWorkbenchSnapshot } from '../../workbench/continuity-store.mjs';
import {
  deleteTaskMapPlanForSession,
  saveTaskMapPlanForSession,
} from '../../workbench/task-map-plan-service.mjs';
import {
  createCaptureItem,
  createNode as createWorkbenchNode,
  createProject as createWorkbenchProject,
  createProjectSummary,
  promoteCaptureItem,
  writeProjectToObsidian,
} from '../../workbench/project-write-service.mjs';
import {
  createBranchFromSession,
  createBranchFromNode,
  mergeBranchSessionBackToMain,
  reparentSession,
  setBranchSessionStatus,
  setSessionReminderSnooze,
} from '../../workbench/branch-lifecycle.mjs';
import { setBranchCandidateSuppressed } from '../../workbench/branch-candidate-service.mjs';
import { handoffSessionData } from '../../workbench/task-handoff.mjs';
import { recordBranchDispatchSignal } from '../../workbench/branch-dispatch-signals.mjs';
import { normalizeNullableText } from '../../workbench/shared.mjs';

export async function createWorkbenchCaptureForWrite(payload = {}) {
  return createCaptureItem(payload);
}

export async function createWorkbenchProjectForWrite(payload = {}) {
  return createWorkbenchProject(payload);
}

export async function createWorkbenchNodeForWrite(payload = {}) {
  return createWorkbenchNode(payload);
}

export async function promoteWorkbenchCaptureForWrite(captureId, payload = {}) {
  return promoteCaptureItem(captureId, payload);
}

export async function createWorkbenchNodeBranchForWrite(nodeId, payload = {}) {
  const sourceSessionId = normalizeNullableText(payload?.sourceSessionId);
  await recordBranchDispatchSignal(sourceSessionId, {
    outcome: 'attempt',
    sourceSessionId,
  });
  try {
    const outcome = await createBranchFromNode(nodeId, payload);
    await recordBranchDispatchSignal(sourceSessionId, {
      outcome: 'success',
      branchTitle: normalizeNullableText(payload?.goal) || normalizeNullableText(outcome?.branchContext?.goal || ''),
      sourceSessionId,
    });
    return outcome;
  } catch (error) {
    await recordBranchDispatchSignal(sourceSessionId, {
      outcome: 'failure',
      failureReason: String(error?.message || ''),
      sourceSessionId,
    });
    throw error;
  }
}

export async function createWorkbenchSessionBranchForWrite(sessionId, payload = {}) {
  await recordBranchDispatchSignal(sessionId, {
    outcome: 'attempt',
  });
  try {
    const outcome = await createBranchFromSession(sessionId, payload);
    await recordBranchDispatchSignal(sessionId, {
      outcome: 'success',
      branchTitle: normalizeNullableText(payload?.goal) || normalizeNullableText(outcome?.branchContext?.goal || ''),
    });
    return outcome;
  } catch (error) {
    await recordBranchDispatchSignal(sessionId, {
      outcome: 'failure',
      failureReason: String(error?.message || ''),
    });
    throw error;
  }
}

export async function handoffWorkbenchSessionForWrite(sessionId, payload = {}) {
  return handoffSessionData(sessionId, payload);
}

export async function reparentWorkbenchSessionForWrite(sessionId, payload = {}) {
  return reparentSession(sessionId, payload);
}

export async function applyWorkbenchSessionGraphOpsForWrite(sessionId, payload = {}) {
  const graphOps = payload?.graphOps && typeof payload.graphOps === 'object'
    ? payload.graphOps
    : payload;
  const outcome = await applySessionGraphOps(sessionId, graphOps);
  return {
    ok: true,
    appliedCount: outcome?.appliedCount || 0,
    historyChanged: outcome?.historyChanged === true,
    sessionChanged: outcome?.sessionChanged === true,
    snapshot: await getWorkbenchSnapshot(),
  };
}

export async function saveWorkbenchTaskMapPlanForWrite(sessionId, payload = {}) {
  return saveTaskMapPlanForSession(sessionId, payload);
}

export async function deleteWorkbenchTaskMapPlanForWrite(sessionId, planId) {
  return deleteTaskMapPlanForSession(sessionId, planId);
}

export async function setWorkbenchCandidateSuppressionForWrite(sessionId, payload = {}) {
  const branchTitle = typeof payload?.branchTitle === 'string' ? payload.branchTitle.trim() : '';
  if (!branchTitle) {
    throw new Error('branchTitle is required');
  }
  return setBranchCandidateSuppressed(sessionId, branchTitle, payload?.suppressed !== false);
}

export async function setWorkbenchBranchSessionStatusForWrite(sessionId, payload = {}) {
  return setBranchSessionStatus(sessionId, payload);
}

export async function setWorkbenchSessionReminderForWrite(sessionId, payload = {}) {
  return setSessionReminderSnooze(sessionId, payload);
}

export async function mergeWorkbenchBranchReturnForWrite(sessionId, payload = {}) {
  return mergeBranchSessionBackToMain(sessionId, payload);
}

export async function createWorkbenchProjectSummaryForWrite(projectId) {
  return createProjectSummary(projectId);
}

export async function writeWorkbenchProjectToObsidianForWrite(projectId, payload = {}) {
  return writeProjectToObsidian(projectId, payload);
}
