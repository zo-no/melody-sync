export function isOwnerOnlyRoute(pathname, method) {
  if (pathname === '/api/workbench' && method === 'GET') return true;
  if (pathname.startsWith('/api/workbench/')) return true;
  if (pathname === '/api/sessions' && (method === 'GET' || method === 'POST')) return true;
  if (pathname === '/api/triggers' && (method === 'GET' || method === 'POST')) return true;
  if (pathname.startsWith('/api/triggers/') && ['GET', 'PATCH', 'DELETE'].includes(method)) return true;
  if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/fork') && method === 'POST') return true;
  if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/delegate') && method === 'POST') return true;
  if (pathname.startsWith('/api/sessions/') && pathname.endsWith('/organize') && method === 'POST') return true;
  if (pathname.startsWith('/api/sessions/') && method === 'PATCH') return true;
  if (pathname === '/api/models' && method === 'GET') return true;
  if (pathname === '/api/tools' && (method === 'GET' || method === 'POST')) return true;
  if (pathname === '/api/autocomplete' && method === 'GET') return true;
  if (pathname === '/api/browse' && method === 'GET') return true;
  if (pathname === '/api/push/vapid-public-key' && method === 'GET') return true;
  if (pathname === '/api/push/subscribe' && method === 'POST') return true;
  if (pathname === '/api/system/completion-sound' && method === 'POST') return true;
  return false;
}
