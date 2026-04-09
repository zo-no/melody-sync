import {
  persistEmailSettingsPayload,
  readEmailSettingsPayload,
} from '../../settings/email.mjs';
import {
  persistGeneralSettingsPayload,
  readGeneralSettingsPayload,
} from '../../settings/general.mjs';
import { createHookSettingsPayload, updateHookEnabledState } from '../../settings/hooks.mjs';
import { createNodeSetting, createNodeSettingsPayload, deleteNodeSetting, updateNodeSetting } from '../../settings/nodes.mjs';
import { listSettingsSectionDefinitions } from '../../settings/registry.mjs';
import {
  persistVoiceSettingsPayload,
  readVoiceSettingsPayload,
} from '../../settings/voice.mjs';

export async function getGeneralSettingsForClient() {
  return readGeneralSettingsPayload();
}

export function getSettingsCatalogForClient() {
  return {
    sections: listSettingsSectionDefinitions(),
  };
}

export async function getEmailSettingsForClient() {
  return readEmailSettingsPayload();
}

export async function getVoiceSettingsForClient() {
  return readVoiceSettingsPayload();
}

export function getHookSettingsForClient() {
  return createHookSettingsPayload();
}

export function getNodeSettingsForClient() {
  return createNodeSettingsPayload();
}

export async function updateGeneralSettingsForClient(payload, { scheduleConfigReload } = {}) {
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
    taskListTemplateGroups: Object.prototype.hasOwnProperty.call(payload, 'taskListTemplateGroups')
      ? payload.taskListTemplateGroups
      : (Array.isArray(current?.taskListTemplateGroups) ? current.taskListTemplateGroups : undefined),
  };
  const next = await persistGeneralSettingsPayload(nextPayload);
  const rootsChanged = (
    (current?.brainRoot || current?.appRoot || '') !== (next?.brainRoot || next?.appRoot || '')
    || (current?.runtimeRoot || '') !== (next?.runtimeRoot || '')
  );
  const reloadScheduled = rootsChanged && typeof scheduleConfigReload === 'function'
    ? scheduleConfigReload()
    : false;
  return {
    ...next,
    reloadRequired: rootsChanged,
    reloadScheduled,
  };
}

export async function updateEmailSettingsForClient(payload) {
  return persistEmailSettingsPayload(payload);
}

export async function updateVoiceSettingsForClient(payload) {
  return persistVoiceSettingsPayload(payload);
}

export async function updateHookSettingsForClient(hookId, enabled) {
  return updateHookEnabledState(hookId, enabled);
}

export async function createNodeSettingForClient(payload) {
  return createNodeSetting(payload);
}

export async function updateNodeSettingForClient(nodeKindId, payload) {
  return updateNodeSetting(nodeKindId, payload);
}

export async function deleteNodeSettingForClient(nodeKindId) {
  return deleteNodeSetting(nodeKindId);
}
