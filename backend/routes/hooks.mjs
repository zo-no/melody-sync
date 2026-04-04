import { readBody } from '../../lib/utils.mjs';
import { createHookSettingsPayload, updateHookEnabledState } from '../settings/hooks.mjs';

export async function handleHooksRoutes({ req, res, pathname, writeJson } = {}) {
  // Legacy alias. The canonical owner-facing settings surface is /api/settings/hooks.
  if (pathname === '/api/hooks' && req?.method === 'GET') {
    writeJson(res, 200, createHookSettingsPayload());
    return true;
  }

  // Legacy alias. The canonical owner-facing settings surface is /api/settings/hooks/:id.
  if (pathname.startsWith('/api/hooks/') && req?.method === 'PATCH') {
    const hookId = decodeURIComponent(pathname.slice('/api/hooks/'.length));
    if (!hookId) {
      writeJson(res, 400, { error: 'hookId is required' });
      return true;
    }
    let body = {};
    try {
      const raw = await readBody(req, 4096);
      body = raw ? JSON.parse(raw) : {};
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    if (typeof body.enabled !== 'boolean') {
      writeJson(res, 400, { error: 'enabled (boolean) is required' });
      return true;
    }
    try {
      writeJson(res, 200, await updateHookEnabledState(hookId, body.enabled));
      return true;
    } catch (error) {
      const message = error?.message || 'Failed to update hook settings';
      writeJson(res, message === 'Hook not found' ? 404 : 400, { error: message });
      return true;
    }
  }

  return false;
}
