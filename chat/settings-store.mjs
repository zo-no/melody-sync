import { homedir } from 'os';
import { dirname, resolve } from 'path';
import { readFile, stat } from 'fs/promises';
import {
  CUSTOM_HOOKS_FILE,
  DEFAULT_MELODYSYNC_APP_ROOT,
  GENERAL_SETTINGS_BOOTSTRAP_FILE,
  GENERAL_SETTINGS_FILE,
  MELODYSYNC_AGENTS_FILENAME,
  MELODYSYNC_AGENTS_FILE,
  MELODYSYNC_APP_ROOT,
  buildDefaultAgentsContent,
  buildMelodySyncPaths,
  resolveMelodySyncDefaultAgentsPath,
  resolveMelodySyncAppRoot,
} from '../lib/config.mjs';
import { ensureDir, readJson, writeJsonAtomic, writeTextAtomic } from './fs-utils.mjs';

const DEFAULT_SETTINGS = Object.freeze({
  appRoot: '',
});

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAppRootPath(value) {
  const trimmed = trimText(value);
  if (!trimmed) return '';
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/')) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function normalizeGeneralSettings(value = {}) {
  const nextAppRootPath = normalizeAppRootPath(
    value?.appRoot || value?.appRootPath || value?.app?.root,
  );
  return {
    appRoot: nextAppRootPath,
  };
}

function deriveGeneralSettingsMetadata(settings = {}) {
  const normalizedSettings = normalizeGeneralSettings(settings);
  const { appRoot } = normalizedSettings;
  const configuredAppRootPath = normalizeAppRootPath(appRoot);
  const resolvedAppRoot = configuredAppRootPath
    ? resolveMelodySyncAppRoot(configuredAppRootPath)
    : (MELODYSYNC_APP_ROOT || DEFAULT_MELODYSYNC_APP_ROOT);
  const resolvedAgentsPath = resolvedAppRoot
    ? resolveMelodySyncDefaultAgentsPath(resolvedAppRoot)
    : MELODYSYNC_AGENTS_FILE;
  if (!resolvedAppRoot) {
    return {
      configuredAppRootPath,
      appRoot: '',
      storagePath: GENERAL_SETTINGS_FILE,
      bootstrapStoragePath: GENERAL_SETTINGS_BOOTSTRAP_FILE,
      customHooksPath: CUSTOM_HOOKS_FILE,
      agentsPath: resolvedAgentsPath,
    };
  }
  const paths = buildMelodySyncPaths(resolvedAppRoot, { agentsFile: resolvedAgentsPath });
  return {
    configuredAppRootPath,
    appRoot: resolvedAppRoot,
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

async function ensureAgentsFile(path) {
  if (await readAgentsContent(path)) return;
  await ensureDir(dirname(path));
  await writeTextAtomic(path, buildDefaultAgentsContent());
}

async function ensureHooksFile(path) {
  try {
    await readFile(path, 'utf8');
    return;
  } catch {
    await ensureDir(dirname(path));
    await writeTextAtomic(path, '[]\n');
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
  const bootstrapPayload = await readJson(GENERAL_SETTINGS_BOOTSTRAP_FILE, DEFAULT_SETTINGS);
  const bootstrapNormalized = normalizeGeneralSettings(bootstrapPayload);
  const bootstrapMetadata = deriveGeneralSettingsMetadata(bootstrapNormalized);
  const payload = await readJson(bootstrapMetadata.storagePath, bootstrapNormalized);
  const normalized = normalizeGeneralSettings(payload);
  const metadata = deriveGeneralSettingsMetadata(normalized);
  return {
    ...normalized,
    ...metadata,
  };
}

export async function persistGeneralSettings(payload = {}) {
  const normalized = normalizeGeneralSettings(payload);
  if (normalized.appRoot && !(await isDirectoryPath(normalized.appRoot))) {
    await ensureDir(normalized.appRoot);
    if (!(await isDirectoryPath(normalized.appRoot))) {
      throw new Error('应用路径不存在或不是目录');
    }
  }
  await writeJsonAtomic(GENERAL_SETTINGS_BOOTSTRAP_FILE, normalized);

  const metadata = deriveGeneralSettingsMetadata(normalized);
  const paths = buildMelodySyncPaths(metadata.appRoot, { agentsFile: metadata.agentsPath });
  await ensureDir(paths.configDir);
  await ensureDir(paths.hooksDir);
  await ensureDir(paths.sessionsDir);
  await ensureDir(paths.workbenchDir);
  await ensureDir(paths.memoryDir);
  await ensureDir(paths.logsDir);
  await ensureDir(resolve(paths.memoryDir, 'tasks'));
  await writeJsonAtomic(paths.generalSettingsFile, normalized);
  await ensureAgentsFile(metadata.agentsPath);
  await ensureHooksFile(paths.customHooksFile);

  return {
    ...normalized,
    ...metadata,
  };
}

export async function ensureGeneralSettingsRuntimeFiles() {
  const current = await readGeneralSettings();
  const metadata = deriveGeneralSettingsMetadata(current);
  const paths = buildMelodySyncPaths(metadata.appRoot, { agentsFile: metadata.agentsPath });
  await ensureDir(paths.configDir);
  await ensureDir(paths.hooksDir);
  await ensureDir(paths.sessionsDir);
  await ensureDir(paths.workbenchDir);
  await ensureDir(paths.memoryDir);
  await ensureDir(paths.logsDir);
  await ensureDir(resolve(paths.memoryDir, 'tasks'));
  await ensureAgentsFile(metadata.agentsPath);
  await ensureHooksFile(paths.customHooksFile);
  return {
    ...current,
    ...metadata,
  };
}

export function exposeGeneralSettingsDefaults() {
  const metadata = deriveGeneralSettingsMetadata(DEFAULT_SETTINGS);
  return {
    appRoot: DEFAULT_SETTINGS.appRoot,
    ...metadata,
  };
}
