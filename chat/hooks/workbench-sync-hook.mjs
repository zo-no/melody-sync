import { syncSessionContinuityFromSession } from '../workbench-store.mjs';

export async function workbenchSyncHook({ sessionId, session }) {
  if (!session) return;
  await syncSessionContinuityFromSession(session).catch((err) => {
    console.error(`[session-hooks] workbench-sync ${sessionId}: ${err.message}`);
  });
}
