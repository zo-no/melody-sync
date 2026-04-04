import {
  dispatchSessionEmailCompletionTargets,
  sanitizeEmailCompletionTargets,
} from '../../lib/agent-mail-completion-targets.mjs';

export async function emailCompletionHook({ sessionId, run, session, manifest }) {
  if (!session?.id || !run?.id || manifest?.internalOperation) return;
  const targets = sanitizeEmailCompletionTargets(session.completionTargets || []);
  if (targets.length === 0) return;
  await dispatchSessionEmailCompletionTargets(
    { ...session, completionTargets: targets },
    run,
  ).catch((err) => {
    console.error(`[session-hooks] email ${sessionId}/${run.id}: ${err.message}`);
  });
}
