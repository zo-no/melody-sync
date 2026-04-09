import {
  createBranchFromSession,
  createBranchFromNode,
  mergeBranchSessionBackToMain,
  reparentSession,
  setBranchSessionStatus,
  setSessionReminderSnooze,
} from './branch-lifecycle.mjs';
import { setBranchCandidateSuppressed } from './branch-candidate-service.mjs';
import { handoffSessionData } from './task-handoff.mjs';
import { recordBranchDispatchSignal } from './branch-dispatch-signals.mjs';
import { normalizeNullableText } from './shared.mjs';

export async function createBranchFromNodeWithSignals(nodeId, payload = {}) {
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

export async function createBranchFromSessionWithSignals(sessionId, payload = {}) {
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

export async function handoffSessionDataForWorkbench(sessionId, payload = {}) {
  return handoffSessionData(sessionId, payload);
}

export async function reparentWorkbenchSession(sessionId, payload = {}) {
  return reparentSession(sessionId, payload);
}

export async function setWorkbenchBranchCandidateSuppressed(sessionId, payload = {}) {
  const branchTitle = typeof payload?.branchTitle === 'string' ? payload.branchTitle.trim() : '';
  if (!branchTitle) {
    throw new Error('branchTitle is required');
  }
  return setBranchCandidateSuppressed(sessionId, branchTitle, payload?.suppressed !== false);
}

export async function setWorkbenchSessionBranchStatus(sessionId, payload = {}) {
  return setBranchSessionStatus(sessionId, payload);
}

export async function setWorkbenchSessionReminder(sessionId, payload = {}) {
  return setSessionReminderSnooze(sessionId, payload);
}

export async function mergeWorkbenchBranchReturn(sessionId, payload = {}) {
  return mergeBranchSessionBackToMain(sessionId, payload);
}
