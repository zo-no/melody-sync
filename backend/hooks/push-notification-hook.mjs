import { sendCompletionPush } from '../push.mjs';

export async function pushNotificationHook({ sessionId, session }) {
  await sendCompletionPush({ ...session, id: sessionId }).catch(() => {});
}
