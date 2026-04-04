import { readBody } from '../../lib/utils.mjs';
import {
  persistEmailSettings,
  readEmailSettings,
} from '../email-settings-store.mjs';
import {
  readGeneralSettings,
  persistGeneralSettings,
} from '../settings-store.mjs';

export async function handleSettingsRoutes({ req, res, pathname, writeJson, scheduleConfigReload } = {}) {
  const isSettingsRoute = pathname === '/api/settings' || pathname === '/api/settings/';
  const isEmailSettingsRoute = pathname === '/api/settings/email' || pathname === '/api/settings/email/';

  if (isSettingsRoute && req?.method === 'GET') {
    const settings = await readGeneralSettings();
    writeJson(res, 200, settings);
    return true;
  }

  if (isEmailSettingsRoute && req?.method === 'GET') {
    const settings = await readEmailSettings();
    writeJson(res, 200, settings);
    return true;
  }

  if (isSettingsRoute && req?.method === 'PATCH') {
    let payload = {};
    try {
      const raw = await readBody(req, 128 * 1024);
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    try {
      const current = await readGeneralSettings();
      const next = await persistGeneralSettings(payload);
      const appRootChanged = !!(current?.appRoot && next?.appRoot && current.appRoot !== next.appRoot);
      const restartScheduled = appRootChanged && typeof scheduleConfigReload === 'function'
        ? scheduleConfigReload()
        : false;
      writeJson(res, 200, {
        ...next,
        reloadRequired: appRootChanged,
        reloadScheduled: restartScheduled,
      });
      return true;
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to update settings' });
      return true;
    }
  }

  if (isEmailSettingsRoute && req?.method === 'PATCH') {
    let payload = {};
    try {
      const raw = await readBody(req, 256 * 1024);
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    try {
      const next = await persistEmailSettings(payload);
      writeJson(res, 200, next);
      return true;
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to update email settings' });
      return true;
    }
  }

  return false;
}
