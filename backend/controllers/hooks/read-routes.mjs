import { getHookSettingsAliasPayload } from '../../services/hooks/http-service.mjs';

export async function handleHookReadRoutes({ req, res, pathname, writeJson } = {}) {
  if (pathname === '/api/hooks' && req?.method === 'GET') {
    writeJson(res, 200, getHookSettingsAliasPayload());
    return true;
  }

  return false;
}
