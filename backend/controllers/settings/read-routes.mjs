import {
  getEmailSettingsForClient,
  getGeneralSettingsForClient,
  getHookSettingsForClient,
  getNodeSettingsForClient,
  getSettingsCatalogForClient,
  getVoiceSettingsForClient,
} from '../../services/settings/http-service.mjs';

export async function handleSettingsReadRoutes(ctx) {
  const { req, res, pathname, writeJson } = ctx;
  const isSettingsRoute = pathname === '/api/settings' || pathname === '/api/settings/';
  const isSettingsCatalogRoute = pathname === '/api/settings/catalog' || pathname === '/api/settings/catalog/';
  const isEmailSettingsRoute = pathname === '/api/settings/email' || pathname === '/api/settings/email/';
  const isVoiceSettingsRoute = pathname === '/api/settings/voice' || pathname === '/api/settings/voice/';
  const isHookSettingsRoute = pathname === '/api/settings/hooks' || pathname === '/api/settings/hooks/';
  const isNodeSettingsRoute = pathname === '/api/settings/nodes' || pathname === '/api/settings/nodes/';

  if (isSettingsRoute && req?.method === 'GET') {
    const settings = await getGeneralSettingsForClient();
    writeJson(res, 200, settings);
    return true;
  }

  if (isSettingsCatalogRoute && req?.method === 'GET') {
    writeJson(res, 200, getSettingsCatalogForClient());
    return true;
  }

  if (isEmailSettingsRoute && req?.method === 'GET') {
    const settings = await getEmailSettingsForClient();
    writeJson(res, 200, settings);
    return true;
  }

  if (isVoiceSettingsRoute && req?.method === 'GET') {
    const settings = await getVoiceSettingsForClient();
    writeJson(res, 200, settings);
    return true;
  }

  if (isHookSettingsRoute && req?.method === 'GET') {
    writeJson(res, 200, getHookSettingsForClient());
    return true;
  }

  if (isNodeSettingsRoute && req?.method === 'GET') {
    writeJson(res, 200, getNodeSettingsForClient());
    return true;
  }

  return false;
}
