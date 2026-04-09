import { applySessionGraphOps } from '../session/manager.mjs';
import { getWorkbenchSnapshot } from './continuity-store.mjs';
import {
  deleteTaskMapPlanForSession,
  saveTaskMapPlanForSession,
} from './task-map-plan-service.mjs';

export async function applyWorkbenchSessionGraphOps(sessionId, payload = {}) {
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

export async function saveWorkbenchTaskMapPlan(sessionId, payload = {}) {
  return saveTaskMapPlanForSession(sessionId, payload);
}

export async function deleteWorkbenchTaskMapPlan(sessionId, planId) {
  return deleteTaskMapPlanForSession(sessionId, planId);
}
