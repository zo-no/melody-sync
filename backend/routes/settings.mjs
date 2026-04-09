import { handleSettingsReadRoutes } from '../controllers/settings/read-routes.mjs';
import { handleSettingsWriteRoutes } from '../controllers/settings/write-routes.mjs';

export async function handleSettingsRoutes({ req, res, pathname, writeJson, scheduleConfigReload } = {}) {
  if (await handleSettingsReadRoutes({ req, res, pathname, writeJson })) return true;
  if (await handleSettingsWriteRoutes({ req, res, pathname, writeJson, scheduleConfigReload })) return true;

  return false;
}
