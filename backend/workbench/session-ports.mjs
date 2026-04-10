import {
  createSession,
  getSession,
  listSessions,
  setSessionBranchCandidateSuppressed,
  submitHttpMessage,
  updateSessionLineage,
  updateSessionTaskPoolMembership,
  updateSessionTaskCard,
} from '../session/manager.mjs';

export async function createWorkbenchSession(folder, tool, name, extra = {}) {
  return createSession(folder, tool, name, extra);
}

export async function getWorkbenchSession(sessionId, options = {}) {
  return getSession(sessionId, options);
}

export async function listWorkbenchSessions(options = {}) {
  return listSessions(options);
}

export async function setWorkbenchSessionBranchCandidateSuppressed(sessionId, branchTitle, suppressed) {
  return setSessionBranchCandidateSuppressed(sessionId, branchTitle, suppressed);
}

export async function submitWorkbenchSessionMessage(sessionId, text, images, options = {}) {
  return submitHttpMessage(sessionId, text, images, options);
}

export async function updateWorkbenchSessionTaskCard(sessionId, taskCard, options = {}) {
  return updateSessionTaskCard(sessionId, taskCard, options);
}

export async function updateWorkbenchSessionLineage(sessionId, payload = {}) {
  return updateSessionLineage(sessionId, payload);
}

export async function updateWorkbenchSessionTaskPoolMembership(sessionId, taskPoolMembership = null) {
  return updateSessionTaskPoolMembership(sessionId, taskPoolMembership);
}
