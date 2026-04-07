import { sendCompletionPush } from '../push.mjs';
import { normalizeSessionWorkflowState, SESSION_WORKFLOW_STATE_DONE } from '../session-workflow-state.mjs';

export async function pushNotificationHook({ sessionId, session }) {
  if (normalizeSessionWorkflowState(session?.workflowState || '') !== SESSION_WORKFLOW_STATE_DONE) return;
  await sendCompletionPush({ ...session, id: sessionId }).catch(() => {});
}
