function canAccessSession(authSession, sessionId) {
  return !!authSession && !!sessionId;
}

export function createSessionAccessGuard(writeJson) {
  return function requireSessionAccess(res, authSession, sessionId) {
    if (canAccessSession(authSession, sessionId)) return true;
    writeJson(res, 403, { error: 'Access denied' });
    return false;
  };
}
