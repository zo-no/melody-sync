import {
  createCaptureItem,
  createNode as createWorkbenchNode,
  createProject as createWorkbenchProject,
  createProjectSummary,
  promoteCaptureItem,
  writeProjectToObsidian,
} from '../../workbench/project-write-service.mjs';
import {
  createBranchFromNodeWithSignals,
  createBranchFromSessionWithSignals,
  handoffSessionDataForWorkbench,
  mergeWorkbenchBranchReturn,
  reparentWorkbenchSession,
  setWorkbenchBranchCandidateSuppressed,
  setWorkbenchSessionBranchStatus,
  setWorkbenchSessionReminder,
} from '../../workbench/branch-write-service.mjs';
import {
  listWorkbenchMemoryCandidatesForSession,
  updateWorkbenchMemoryCandidateStatus,
} from '../../workbench/memory-candidate-store.mjs';
import { applyMemoryCandidateWriteback } from '../../hooks/memory-writeback-hook.mjs';
import {
  applyWorkbenchSessionGraphOps,
  deleteWorkbenchTaskMapPlan,
  saveWorkbenchTaskMapPlan,
} from '../../workbench/task-map-write-service.mjs';

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
  return createBranchFromNodeWithSignals(nodeId, payload);
}

export async function createWorkbenchSessionBranchForWrite(sessionId, payload = {}) {
  return createBranchFromSessionWithSignals(sessionId, payload);
}

export async function handoffWorkbenchSessionForWrite(sessionId, payload = {}) {
  return handoffSessionDataForWorkbench(sessionId, payload);
}

export async function reparentWorkbenchSessionForWrite(sessionId, payload = {}) {
  return reparentWorkbenchSession(sessionId, payload);
}

export async function applyWorkbenchSessionGraphOpsForWrite(sessionId, payload = {}) {
  return applyWorkbenchSessionGraphOps(sessionId, payload);
}

export async function saveWorkbenchTaskMapPlanForWrite(sessionId, payload = {}) {
  return saveWorkbenchTaskMapPlan(sessionId, payload);
}

export async function deleteWorkbenchTaskMapPlanForWrite(sessionId, planId) {
  return deleteWorkbenchTaskMapPlan(sessionId, planId);
}

export async function setWorkbenchCandidateSuppressionForWrite(sessionId, payload = {}) {
  return setWorkbenchBranchCandidateSuppressed(sessionId, payload);
}

export async function setWorkbenchBranchSessionStatusForWrite(sessionId, payload = {}) {
  return setWorkbenchSessionBranchStatus(sessionId, payload);
}

export async function setWorkbenchSessionReminderForWrite(sessionId, payload = {}) {
  return setWorkbenchSessionReminder(sessionId, payload);
}

export async function mergeWorkbenchBranchReturnForWrite(sessionId, payload = {}) {
  return mergeWorkbenchBranchReturn(sessionId, payload);
}

export async function updateWorkbenchMemoryCandidateStatusForWrite(sessionId, candidateId, payload = {}) {
  const nextStatus = typeof payload?.status === 'string' ? payload.status.trim() : '';
  if (!nextStatus) {
    throw new Error('status is required');
  }
  const current = (await listWorkbenchMemoryCandidatesForSession(sessionId, { includeResolved: true }))
    .find((entry) => entry.id === candidateId);
  if (!current) {
    throw new Error('Memory candidate not found');
  }

  const updated = await updateWorkbenchMemoryCandidateStatus(sessionId, candidateId, nextStatus, payload);
  if (['approved', 'active'].includes(updated.status)) {
    await applyMemoryCandidateWriteback(updated, {
      sessionId,
      sessionName: updated.sessionName,
    });
  }
  return updated;
}

export async function createWorkbenchProjectSummaryForWrite(projectId) {
  return createProjectSummary(projectId);
}

export async function writeWorkbenchProjectToObsidianForWrite(projectId, payload = {}) {
  return writeProjectToObsidian(projectId, payload);
}
