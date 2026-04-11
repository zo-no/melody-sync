import { createHookSettingsPayload } from '../../settings/hooks.mjs';

export async function handleHookReadRoutes(ctx) {
  const { req, res, pathname, writeJson } = ctx;
  if (pathname === '/api/hooks' && req?.method === 'GET') {
    writeJson(res, 200, createHookSettingsPayload());
    return true;
  }

  return false;
}
