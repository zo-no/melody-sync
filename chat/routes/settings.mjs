import { readBody } from '../../lib/utils.mjs';
import {
  readGeneralSettings,
  persistGeneralSettings,
} from '../settings-store.mjs';

export async function handleSettingsRoutes({ req, res, pathname, writeJson } = {}) {
  const isSettingsRoute = pathname === '/api/settings' || pathname === '/api/settings/';

  if (isSettingsRoute && req?.method === 'GET') {
    const settings = await readGeneralSettings();
    writeJson(res, 200, settings);
    return true;
  }

  if (isSettingsRoute && req?.method === 'PATCH') {
    let payload = {};
    try {
      const raw = await readBody(req, 4096);
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    try {
      const next = await persistGeneralSettings(payload);
      writeJson(res, 200, next);
      return true;
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to update settings' });
      return true;
    }
  }

  return false;
}
