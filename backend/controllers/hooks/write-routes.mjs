import { readJsonRequestBody } from '../../shared/http/request-body.mjs';
import { updateHookEnabledState } from '../../settings/hooks.mjs';

export async function handleHookWriteRoutes(ctx) {
  const { req, res, pathname, writeJson } = ctx;
  if (pathname.startsWith('/api/hooks/') && req?.method === 'PATCH') {
    const hookId = decodeURIComponent(pathname.slice('/api/hooks/'.length));
    if (!hookId) {
      writeJson(res, 400, { error: 'hookId is required' });
      return true;
    }
    let body = {};
    try {
      body = await readJsonRequestBody(req, 4096);
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
