import { getAuthSession } from '../lib/auth.mjs';

function requireOwner(req, res) {
  const authSession = getAuthSession(req);
  if (authSession?.role === 'owner') return true;
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Owner access required' }));
  return false;
}

export async function handleAdminRoutes({
  req,
  res,
  pathname,
}) {
  const isUserRoute = pathname === '/api/users' || pathname.startsWith('/api/users/');
  if (!isUserRoute) {
    return false;
  }

  if (!requireOwner(req, res)) return true;

  res.writeHead(410, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'User management has been removed from MelodySync' }));
  return true;
}
