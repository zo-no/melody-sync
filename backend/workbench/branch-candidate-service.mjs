import { setWorkbenchSessionBranchCandidateSuppressed } from './session-ports.mjs';

export async function setBranchCandidateSuppressed(sessionId, branchTitle, suppressed = true) {
  const session = await setWorkbenchSessionBranchCandidateSuppressed(sessionId, branchTitle, suppressed);
  return { session };
}
