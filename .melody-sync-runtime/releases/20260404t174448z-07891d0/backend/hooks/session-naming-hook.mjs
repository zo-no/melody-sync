export function createSessionNamingHook({ isSessionAutoRenamePending, triggerAutomaticSessionLabeling }) {
  if (typeof isSessionAutoRenamePending !== 'function') {
    throw new Error('createSessionNamingHook requires isSessionAutoRenamePending');
  }
  if (typeof triggerAutomaticSessionLabeling !== 'function') {
    throw new Error('createSessionNamingHook requires triggerAutomaticSessionLabeling');
  }

  return async function sessionNamingHook({ sessionId, session, manifest }) {
    if (manifest?.internalOperation) return;
    if (!session) return;
    await triggerAutomaticSessionLabeling(sessionId, session).catch((err) => {
      console.error(`[session-hooks] session-naming ${sessionId}: ${err.message}`);
    });
  };
}
