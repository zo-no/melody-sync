import { readJsonRequestBody } from '../../shared/http/request-body.mjs';
import {
  createNodeSettingForClient,
  deleteNodeSettingForClient,
  updateEmailSettingsForClient,
  updateGeneralSettingsForClient,
  updateHookSettingsForClient,
  updateNodeSettingForClient,
  updateVoiceSettingsForClient,
} from '../../services/settings/http-service.mjs';

function writeInvalidBody(writeJson, res) {
  writeJson(res, 400, { error: 'Invalid request body' });
}

export async function handleSettingsWriteRoutes(ctx) {
  const { req, res, pathname, writeJson, scheduleConfigReload } = ctx;
  const isSettingsRoute = pathname === '/api/settings' || pathname === '/api/settings/';
  const isEmailSettingsRoute = pathname === '/api/settings/email' || pathname === '/api/settings/email/';
  const isVoiceSettingsRoute = pathname === '/api/settings/voice' || pathname === '/api/settings/voice/';
  const isNodeSettingsRoute = pathname === '/api/settings/nodes' || pathname === '/api/settings/nodes/';

  if (isSettingsRoute && req?.method === 'PATCH') {
    let payload = {};
    try {
      payload = await readJsonRequestBody(req, 128 * 1024);
    } catch {
      writeInvalidBody(writeJson, res);
      return true;
    }
    try {
      const next = await updateGeneralSettingsForClient(payload, { scheduleConfigReload });
      writeJson(res, 200, next);
      return true;
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to update settings' });
      return true;
    }
  }

  if (isEmailSettingsRoute && req?.method === 'PATCH') {
    let payload = {};
    try {
      payload = await readJsonRequestBody(req, 256 * 1024);
    } catch {
      writeInvalidBody(writeJson, res);
      return true;
    }
    try {
      const next = await updateEmailSettingsForClient(payload);
      writeJson(res, 200, next);
      return true;
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to update email settings' });
      return true;
    }
  }

  if (isVoiceSettingsRoute && req?.method === 'PATCH') {
    let payload = {};
    try {
      payload = await readJsonRequestBody(req, 256 * 1024);
    } catch {
      writeInvalidBody(writeJson, res);
      return true;
    }
    try {
      const next = await updateVoiceSettingsForClient(payload);
      writeJson(res, 200, next);
      return true;
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to update voice settings' });
      return true;
    }
  }

  if (pathname.startsWith('/api/settings/hooks/') && req?.method === 'PATCH') {
    const hookId = decodeURIComponent(pathname.slice('/api/settings/hooks/'.length));
    let payload = {};
    try {
      payload = await readJsonRequestBody(req, 4096);
    } catch {
      writeInvalidBody(writeJson, res);
      return true;
    }
    try {
      const next = await updateHookSettingsForClient(hookId, payload?.enabled);
      writeJson(res, 200, next);
      return true;
    } catch (error) {
      const message = error?.message || 'Failed to update hook settings';
      writeJson(res, message === 'Hook not found' ? 404 : 400, { error: message });
      return true;
    }
  }

  if (isNodeSettingsRoute && req?.method === 'POST') {
    let payload = {};
    try {
      payload = await readJsonRequestBody(req, 16384);
    } catch {
      writeInvalidBody(writeJson, res);
      return true;
    }
    try {
      const next = await createNodeSettingForClient(payload);
      writeJson(res, 201, next);
      return true;
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to create node setting' });
      return true;
    }
  }

  if (pathname.startsWith('/api/settings/nodes/') && req?.method === 'PATCH') {
    const nodeKindId = decodeURIComponent(pathname.slice('/api/settings/nodes/'.length));
    let payload = {};
    try {
      payload = await readJsonRequestBody(req, 16384);
    } catch {
      writeInvalidBody(writeJson, res);
      return true;
    }
    try {
      const next = await updateNodeSettingForClient(nodeKindId, payload);
      writeJson(res, 200, next);
      return true;
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to update node setting' });
      return true;
    }
  }

  if (pathname.startsWith('/api/settings/nodes/') && req?.method === 'DELETE') {
    const nodeKindId = decodeURIComponent(pathname.slice('/api/settings/nodes/'.length));
    try {
      const next = await deleteNodeSettingForClient(nodeKindId);
      writeJson(res, 200, next);
      return true;
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to delete node setting' });
      return true;
    }
  }

  return false;
}
