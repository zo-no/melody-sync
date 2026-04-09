import { cancelActiveRun, getRunState } from '../../session/manager.mjs';

export async function getRunForClient(runId) {
  return getRunState(runId);
}

export async function cancelRunForClient(run) {
  if (!run?.sessionId) return null;
  return cancelActiveRun(run.sessionId);
}
