export async function handleAuthRoutes({
  req,
  res,
  pathname,
  getAuthSession,
  buildAuthInfo,
  refreshAuthSession,
  writeJsonCached,
} = {}) {
  if (pathname !== '/api/auth/me' || req?.method !== 'GET') {
    return false;
  }

  const authSession = getAuthSession(req);
  if (!authSession) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not authenticated' }));
    return true;
  }

  const info = buildAuthInfo(authSession);
  const refreshedCookie = await refreshAuthSession(req);
  writeJsonCached(req, res, info, {
    headers: refreshedCookie ? { 'Set-Cookie': refreshedCookie } : undefined,
  });
  return true;
}
