import { HOOKS_FILE } from '../../../lib/config.mjs';
import { readJson, writeJsonAtomic } from '../../fs-utils.mjs';
import { applyHookEnabledOverrides, getHookEnabledOverrides } from './registry.mjs';

function normalizeEnabledById(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value)
    .map(([hookId, enabled]) => [String(hookId || '').trim(), enabled === true])
    .filter(([hookId]) => hookId);
  return Object.fromEntries(entries);
}

function normalizeHookSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { enabledById: {} };
  }
  return {
    enabledById: normalizeEnabledById(value.enabledById),
  };
}

export async function readHookSettings() {
  return normalizeHookSettings(await readJson(HOOKS_FILE, { enabledById: {} }));
}

export async function loadPersistedHookSettings() {
  const settings = await readHookSettings();
  applyHookEnabledOverrides(settings.enabledById);
  return settings;
}

export async function persistHookSettings(settings = {}) {
  const normalized = normalizeHookSettings(settings);
  await writeJsonAtomic(HOOKS_FILE, normalized);
  applyHookEnabledOverrides(normalized.enabledById);
  return normalized;
}

export async function persistHookEnabledState(hookId, enabled) {
  const settings = await readHookSettings();
  const enabledById = {
    ...settings.enabledById,
    [String(hookId || '').trim()]: enabled === true,
  };
  return persistHookSettings({ enabledById });
}

export function exportCurrentHookSettings() {
  return {
    enabledById: getHookEnabledOverrides(),
  };
}
