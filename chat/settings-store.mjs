import { homedir } from 'os';
import { dirname, resolve } from 'path';
import { readFile, stat } from 'fs/promises';
import {
  CUSTOM_HOOKS_FILE,
  DEFAULT_OBSIDIAN_VAULT_DIR,
  GENERAL_SETTINGS_BOOTSTRAP_FILE,
  GENERAL_SETTINGS_FILE,
  MELODYSYNC_AGENTS_FILENAME,
  MELODYSYNC_AGENTS_FILE,
  buildDefaultAgentsContent,
  buildMelodySyncPaths,
  resolveMelodySyncDefaultAgentsPath,
  resolveMelodySyncAppRoot,
  resolveMelodySyncLegacyVaultRoot,
  resolveMelodySyncLegacyVisibleVaultRoot,
} from '../lib/config.mjs';
import { ensureDir, readJson, writeJsonAtomic, writeTextAtomic } from './fs-utils.mjs';

const DEFAULT_SETTINGS = Object.freeze({
  obsidianPath: DEFAULT_OBSIDIAN_VAULT_DIR,
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
  const nextStorageRootPath = normalizeObsidianPath(
    value?.storageRootPath || value?.storageRoot?.path,
  ) || normalizeObsidianPath(value?.obsidianPath || value?.obsidian?.path);
  const rawAgentsPath = normalizeObsidianPath(value?.agentsPath || value?.agentPath || value?.agents?.path);
  const legacyHiddenAgentsPath = nextStorageRootPath
    ? `${resolveMelodySyncLegacyVaultRoot(nextStorageRootPath)}/${MELODYSYNC_AGENTS_FILENAME}`
    : '';
  const legacyVisibleAgentsPath = nextStorageRootPath
    ? `${resolveMelodySyncLegacyVisibleVaultRoot(nextStorageRootPath)}/${MELODYSYNC_AGENTS_FILENAME}`
    : '';
  const agentsPath = rawAgentsPath === legacyHiddenAgentsPath || rawAgentsPath === legacyVisibleAgentsPath
    ? ''
    : rawAgentsPath;
  return {
    obsidianPath: nextStorageRootPath,
    agentsPath,
  };
}

function deriveGeneralSettingsMetadata(settings = {}) {
  const normalizedSettings = normalizeGeneralSettings(settings);
  const { obsidianPath, agentsPath } = normalizedSettings;
  const storageRootPath = normalizeObsidianPath(obsidianPath);
  const appRoot = storageRootPath ? resolveMelodySyncAppRoot(storageRootPath) : '';
  const defaultAgentsPath = storageRootPath ? resolveMelodySyncDefaultAgentsPath(storageRootPath) : MELODYSYNC_AGENTS_FILE;
  const resolvedAgentsPath = agentsPath || defaultAgentsPath;
  if (!appRoot) {
    return {
      storageRootPath,
      appRoot: '',
      storagePath: GENERAL_SETTINGS_FILE,
      bootstrapStoragePath: GENERAL_SETTINGS_BOOTSTRAP_FILE,
      customHooksPath: CUSTOM_HOOKS_FILE,
      agentsPath: resolvedAgentsPath,
    };
  }
  const paths = buildMelodySyncPaths(appRoot);
  return {
    storageRootPath,
    appRoot,
    storagePath: paths.generalSettingsFile,
    bootstrapStoragePath: GENERAL_SETTINGS_BOOTSTRAP_FILE,
    customHooksPath: paths.customHooksFile,
    agentsPath: resolvedAgentsPath,
  };
}

async function readAgentsContent(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
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
  const normalized = normalizeGeneralSettings(payload);
  const metadata = deriveGeneralSettingsMetadata(normalized);
  return {
    ...normalized,
    ...metadata,
    agentsContent: await readAgentsContent(metadata.agentsPath),
  };
}

export async function persistGeneralSettings(payload = {}) {
  const normalized = normalizeGeneralSettings(payload);
  if (normalized.obsidianPath && !(await isDirectoryPath(normalized.obsidianPath))) {
    await ensureDir(normalized.obsidianPath);
    if (!(await isDirectoryPath(normalized.obsidianPath))) {
      throw new Error('本地数据根路径不存在或不是目录');
    }
  }
  await writeJsonAtomic(GENERAL_SETTINGS_BOOTSTRAP_FILE, normalized);

  const metadata = deriveGeneralSettingsMetadata(normalized);
  if (normalized.obsidianPath) {
    const paths = buildMelodySyncPaths(metadata.appRoot);
    await ensureDir(paths.configDir);
    await ensureDir(paths.hooksDir);
    await ensureDir(paths.sessionsDir);
    await ensureDir(paths.workbenchDir);
    await ensureDir(paths.memoryDir);
    await writeJsonAtomic(paths.generalSettingsFile, normalized);
  } else {
    await writeJsonAtomic(GENERAL_SETTINGS_FILE, normalized);
  }

  const nextAgentsContent = typeof payload?.agentsContent === 'string'
    ? payload.agentsContent
    : await readAgentsContent(metadata.agentsPath);
  await ensureDir(dirname(metadata.agentsPath));
  await writeTextAtomic(
    metadata.agentsPath,
    nextAgentsContent || buildDefaultAgentsContent(),
  );

  return {
    ...normalized,
    ...metadata,
    agentsContent: nextAgentsContent || buildDefaultAgentsContent(),
  };
}

export function exposeGeneralSettingsDefaults() {
  const metadata = deriveGeneralSettingsMetadata(DEFAULT_SETTINGS);
  return {
    obsidianPath: DEFAULT_SETTINGS.obsidianPath,
    agentsPath: metadata.agentsPath,
    ...metadata,
  };
}
