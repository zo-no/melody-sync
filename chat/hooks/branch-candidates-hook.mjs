export function createBranchCandidatesHook({ appendEvents, syncBranchCandidateTaskMapPlan }) {
  if (typeof appendEvents !== 'function') {
    throw new Error('createBranchCandidatesHook requires appendEvents');
  }

  return async function branchCandidatesHook(context = {}) {
    const { sessionId, branchCandidateEvents } = context;
    if (!Array.isArray(branchCandidateEvents) || branchCandidateEvents.length === 0) return;
    await appendEvents(sessionId, branchCandidateEvents);
    if (typeof syncBranchCandidateTaskMapPlan === 'function') {
      await syncBranchCandidateTaskMapPlan(context);
    }
  };
}
