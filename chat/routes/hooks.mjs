import { readBody } from '../../lib/utils.mjs';
import {
  HOOK_EVENTS,
  listHookEventDefinitions,
  listHooks,
  setHookEnabled,
} from '../session-hook-registry.mjs';

export async function handleHooksRoutes({ req, res, pathname, writeJson } = {}) {
  // GET /api/hooks — list all registered hooks
  if (pathname === '/api/hooks' && req?.method === 'GET') {
    writeJson(res, 200, {
      events: HOOK_EVENTS,
      eventDefinitions: listHookEventDefinitions(),
      hooks: listHooks(),
    });
    return true;
  }

  // PATCH /api/hooks/:id — enable or disable a hook
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
    const found = setHookEnabled(hookId, body.enabled);
    if (!found) {
      writeJson(res, 404, { error: 'Hook not found' });
      return true;
    }
    writeJson(res, 200, { hooks: listHooks() });
    return true;
  }

  return false;
}
