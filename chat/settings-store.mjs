import { homedir } from 'os';
import { resolve } from 'path';
import { stat } from 'fs/promises';
import { GENERAL_SETTINGS_FILE } from '../lib/config.mjs';
import { ensureDir, readJson, writeJsonAtomic } from './fs-utils.mjs';

const DEFAULT_SETTINGS = Object.freeze({
  obsidianPath: '/Users/kual/Desktop/diary/diary',
});

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeObsidianPath(value) {
  const trimmed = trimText(value);
  if (!trimmed) return '';
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/')) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function normalizeGeneralSettings(value = {}) {
  return {
    obsidianPath: normalizeObsidianPath(value?.obsidianPath || value?.obsidian?.path),
  };
}

async function isDirectoryPath(path) {
  if (!path) return false;
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export async function readGeneralSettings() {
  const payload = await readJson(GENERAL_SETTINGS_FILE, DEFAULT_SETTINGS);
  return normalizeGeneralSettings(payload);
}

export async function persistGeneralSettings(payload = {}) {
  const normalized = normalizeGeneralSettings(payload);
  if (normalized.obsidianPath && !(await isDirectoryPath(normalized.obsidianPath))) {
    await ensureDir(normalized.obsidianPath);
    if (!(await isDirectoryPath(normalized.obsidianPath))) {
      throw new Error('Obsidian 路径不存在或不是目录');
    }
  }
  await writeJsonAtomic(GENERAL_SETTINGS_FILE, normalized);
  return normalized;
}

export function exposeGeneralSettingsDefaults() {
  return {
    obsidianPath: DEFAULT_SETTINGS.obsidianPath,
    storagePath: GENERAL_SETTINGS_FILE,
  };
}
