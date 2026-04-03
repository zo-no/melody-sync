export function createBranchCandidatesHook({ appendEvents }) {
  if (typeof appendEvents !== 'function') {
    throw new Error('createBranchCandidatesHook requires appendEvents');
  }

  return async function branchCandidatesHook({ sessionId, branchCandidateEvents }) {
    if (!Array.isArray(branchCandidateEvents) || branchCandidateEvents.length === 0) return;
    await appendEvents(sessionId, branchCandidateEvents);
  };
}
