import { readBody } from '../../lib/utils.mjs';
import {
  persistEmailSettingsPayload,
  readEmailSettingsPayload,
} from '../settings/email.mjs';
import {
  persistGeneralSettingsPayload,
  readGeneralSettingsPayload,
} from '../settings/general.mjs';
import { createHookSettingsPayload, updateHookEnabledState } from '../settings/hooks.mjs';
import { createNodeSetting, createNodeSettingsPayload, deleteNodeSetting, updateNodeSetting } from '../settings/nodes.mjs';
import { listSettingsSectionDefinitions } from '../settings/registry.mjs';
import {
  persistVoiceSettingsPayload,
  readVoiceSettingsPayload,
} from '../settings/voice.mjs';

export async function handleSettingsRoutes({ req, res, pathname, writeJson, scheduleConfigReload } = {}) {
  const isSettingsRoute = pathname === '/api/settings' || pathname === '/api/settings/';
  const isSettingsCatalogRoute = pathname === '/api/settings/catalog' || pathname === '/api/settings/catalog/';
  const isEmailSettingsRoute = pathname === '/api/settings/email' || pathname === '/api/settings/email/';
  const isVoiceSettingsRoute = pathname === '/api/settings/voice' || pathname === '/api/settings/voice/';
  const isHookSettingsRoute = pathname === '/api/settings/hooks' || pathname === '/api/settings/hooks/';
  const isNodeSettingsRoute = pathname === '/api/settings/nodes' || pathname === '/api/settings/nodes/';

  if (isSettingsRoute && req?.method === 'GET') {
    const settings = await readGeneralSettingsPayload();
    writeJson(res, 200, settings);
    return true;
  }

  if (isSettingsCatalogRoute && req?.method === 'GET') {
    writeJson(res, 200, {
      sections: listSettingsSectionDefinitions(),
    });
    return true;
  }

  if (isEmailSettingsRoute && req?.method === 'GET') {
    const settings = await readEmailSettingsPayload();
    writeJson(res, 200, settings);
    return true;
  }

  if (isVoiceSettingsRoute && req?.method === 'GET') {
    const settings = await readVoiceSettingsPayload();
    writeJson(res, 200, settings);
    return true;
  }

  if (isHookSettingsRoute && req?.method === 'GET') {
    writeJson(res, 200, createHookSettingsPayload());
    return true;
  }

  if (isNodeSettingsRoute && req?.method === 'GET') {
    writeJson(res, 200, createNodeSettingsPayload());
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
      const current = await readGeneralSettingsPayload();
      const nextPayload = {
        brainRoot: Object.prototype.hasOwnProperty.call(payload, 'brainRoot')
          ? payload.brainRoot
          : (Object.prototype.hasOwnProperty.call(payload, 'appRoot')
            ? payload.appRoot
            : (current?.configuredBrainRootPath || current?.brainRoot || current?.appRoot || '')),
        runtimeRoot: Object.prototype.hasOwnProperty.call(payload, 'runtimeRoot')
          ? payload.runtimeRoot
          : (current?.configuredRuntimeRootPath || current?.runtimeRoot || ''),
        completionSoundEnabled: Object.prototype.hasOwnProperty.call(payload, 'completionSoundEnabled')
          ? payload.completionSoundEnabled
          : (current?.completionSoundEnabled === false ? false : undefined),
      };
      const next = await persistGeneralSettingsPayload(nextPayload);
      const rootsChanged = (
        (current?.brainRoot || current?.appRoot || '') !== (next?.brainRoot || next?.appRoot || '')
        || (current?.runtimeRoot || '') !== (next?.runtimeRoot || '')
      );
      const restartScheduled = rootsChanged && typeof scheduleConfigReload === 'function'
        ? scheduleConfigReload()
        : false;
      writeJson(res, 200, {
        ...next,
        reloadRequired: rootsChanged,
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
      const next = await persistEmailSettingsPayload(payload);
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
      const raw = await readBody(req, 256 * 1024);
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    try {
      const next = await persistVoiceSettingsPayload(payload);
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
      const raw = await readBody(req, 4096);
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    try {
      const next = await updateHookEnabledState(hookId, payload?.enabled);
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
      const raw = await readBody(req, 16384);
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    try {
      const next = await createNodeSetting(payload);
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
      const raw = await readBody(req, 16384);
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }
    try {
      const next = await updateNodeSetting(nodeKindId, payload);
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
      const next = await deleteNodeSetting(nodeKindId);
      writeJson(res, 200, next);
      return true;
    } catch (error) {
      writeJson(res, 400, { error: error.message || 'Failed to delete node setting' });
      return true;
    }
  }

  return false;
}
