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

const DEFAULT_APP_SCOPED_SETTINGS = Object.freeze({});
const DEFAULT_COMPLETION_SOUND_ENABLED = true;

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

function normalizeOptionalBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  const normalized = trimText(value).toLowerCase();
  if (!normalized) return null;
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return null;
}

function readCompletionSoundEnabled(value = {}) {
  return normalizeOptionalBoolean(
    value?.completionSoundEnabled
    ?? value?.completion?.soundEnabled
    ?? value?.alerts?.completionSoundEnabled,
  );
}

function normalizeAppScopedSettings(value = {}) {
  const completionSoundEnabled = readCompletionSoundEnabled(value);
  return completionSoundEnabled === null
    ? { ...DEFAULT_APP_SCOPED_SETTINGS }
    : {
      ...DEFAULT_APP_SCOPED_SETTINGS,
      completionSoundEnabled,
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
      emailPath: '',
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
    emailPath: paths.emailDir,
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
  const payload = await readJson(bootstrapMetadata.storagePath, DEFAULT_APP_SCOPED_SETTINGS);
  const appScoped = normalizeAppScopedSettings(payload);
  const metadata = deriveGeneralSettingsMetadata(bootstrapNormalized);
  const completionSoundEnabled = appScoped.completionSoundEnabled === false
    ? false
    : DEFAULT_COMPLETION_SOUND_ENABLED;
  return {
    ...appScoped,
    completionSoundEnabled,
    ...bootstrapNormalized,
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
  await ensureDir(paths.emailDir);
  await ensureDir(paths.hooksDir);
  await ensureDir(paths.voiceDir);
  await ensureDir(paths.voiceLogsDir);
  await ensureDir(paths.sessionsDir);
  await ensureDir(paths.workbenchDir);
  await ensureDir(paths.memoryDir);
  await ensureDir(paths.logsDir);
  await ensureDir(resolve(paths.memoryDir, 'tasks'));
  await writeJsonAtomic(paths.generalSettingsFile, normalizeAppScopedSettings(payload));
  await ensureAgentsFile(metadata.agentsPath);
  await ensureHooksFile(paths.customHooksFile);

  const completionSoundEnabled = readCompletionSoundEnabled(payload);
  return {
    completionSoundEnabled: completionSoundEnabled === null
      ? DEFAULT_COMPLETION_SOUND_ENABLED
      : completionSoundEnabled,
    ...normalized,
    ...metadata,
  };
}

export async function ensureGeneralSettingsRuntimeFiles() {
  const current = await readGeneralSettings();
  const metadata = deriveGeneralSettingsMetadata(current);
  const paths = buildMelodySyncPaths(metadata.appRoot, { agentsFile: metadata.agentsPath });
  const appScopedPayload = await readJson(paths.generalSettingsFile, DEFAULT_APP_SCOPED_SETTINGS);
  await ensureDir(paths.configDir);
  await ensureDir(paths.emailDir);
  await ensureDir(paths.hooksDir);
  await ensureDir(paths.voiceDir);
  await ensureDir(paths.voiceLogsDir);
  await ensureDir(paths.sessionsDir);
  await ensureDir(paths.workbenchDir);
  await ensureDir(paths.memoryDir);
  await ensureDir(paths.logsDir);
  await ensureDir(resolve(paths.memoryDir, 'tasks'));
  await writeJsonAtomic(paths.generalSettingsFile, normalizeAppScopedSettings(appScopedPayload));
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
    completionSoundEnabled: DEFAULT_COMPLETION_SOUND_ENABLED,
    ...metadata,
  };
}
