import { homedir } from 'os';
import { dirname, resolve } from 'path';
import { cp, readFile, readdir, stat } from 'fs/promises';
import {
  CUSTOM_HOOKS_FILE,
  DEFAULT_MELODYSYNC_APP_ROOT,
  DEFAULT_MELODYSYNC_RUNTIME_ROOT,
  GENERAL_SETTINGS_BOOTSTRAP_FILE,
  GENERAL_SETTINGS_FILE,
  MELODYSYNC_AGENTS_FILENAME,
  MELODYSYNC_AGENTS_FILE,
  MELODYSYNC_APP_ROOT,
  MELODYSYNC_RUNTIME_ROOT,
  buildDefaultAgentsContent,
  buildMelodySyncPaths,
  resolveMelodySyncDefaultAgentsPath,
  resolveMelodySyncAppRoot,
  resolveMelodySyncRuntimeRoot,
} from '../../lib/config.mjs';
import { ensureDir, readJson, writeJsonAtomic, writeTextAtomic } from '../fs-utils.mjs';

const DEFAULT_SETTINGS = Object.freeze({
  brainRoot: '',
  runtimeRoot: '',
  appRoot: '',
});

const DEFAULT_APP_SCOPED_SETTINGS = Object.freeze({});
const DEFAULT_COMPLETION_SOUND_ENABLED = true;
const TASK_LIST_TEMPLATE_GROUP_MAX_ITEMS = 12;
const TASK_LIST_TEMPLATE_GROUP_MAX_CHARS = 32;

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
  const nextBrainRootPath = normalizeAppRootPath(
    value?.brainRoot || value?.brainRootPath || value?.brain?.root
    || value?.appRoot || value?.appRootPath || value?.app?.root,
  );
  const nextRuntimeRootPath = normalizeAppRootPath(
    value?.runtimeRoot || value?.runtimeRootPath || value?.runtime?.root,
  );
  return {
    brainRoot: nextBrainRootPath,
    runtimeRoot: nextRuntimeRootPath,
    appRoot: nextBrainRootPath,
  };
}

function resolveMachineConfigRoot() {
  return dirname(GENERAL_SETTINGS_BOOTSTRAP_FILE);
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

function normalizeTaskListTemplateGroup(value) {
  const normalized = trimText(value).replace(/\s+/g, ' ');
  if (!normalized) return '';
  return Array.from(normalized).slice(0, TASK_LIST_TEMPLATE_GROUP_MAX_CHARS).join('');
}

function readTaskListTemplateGroups(value = {}) {
  const source = (
    value?.taskListTemplateGroups
    ?? value?.sessionListTemplateGroups
    ?? value?.taskListGroupingTemplates
    ?? value?.sessionGroupingTemplateGroups
  );
  const entries = Array.isArray(source)
    ? source
    : (typeof source === 'string' ? source.split(/[\n,，]+/u) : []);
  const seen = new Set();
  const groups = [];
  for (const entry of entries) {
    const normalized = normalizeTaskListTemplateGroup(entry);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push(normalized);
    if (groups.length >= TASK_LIST_TEMPLATE_GROUP_MAX_ITEMS) break;
  }
  return groups;
}

function normalizeAppScopedSettings(value = {}) {
  const completionSoundEnabled = readCompletionSoundEnabled(value);
  const taskListTemplateGroups = readTaskListTemplateGroups(value);
  const normalized = { ...DEFAULT_APP_SCOPED_SETTINGS };
  if (completionSoundEnabled !== null) {
    normalized.completionSoundEnabled = completionSoundEnabled;
  }
  if (taskListTemplateGroups.length > 0) {
    normalized.taskListTemplateGroups = taskListTemplateGroups;
  }
  return normalized;
}

function buildPathsFromMetadata(metadata = {}) {
  return buildMelodySyncPaths({
    brainRoot: metadata.brainRoot,
    runtimeRoot: metadata.runtimeRoot,
    machineConfigRoot: resolveMachineConfigRoot(),
    agentsFile: metadata.agentsPath,
  });
}

function deriveGeneralSettingsMetadata(settings = {}) {
  const normalizedSettings = normalizeGeneralSettings(settings);
  const configuredBrainRootPath = normalizeAppRootPath(normalizedSettings.brainRoot);
  const configuredRuntimeRootPath = normalizeAppRootPath(normalizedSettings.runtimeRoot);
  const resolvedBrainRoot = configuredBrainRootPath
    ? resolveMelodySyncAppRoot(configuredBrainRootPath)
    : (MELODYSYNC_APP_ROOT || DEFAULT_MELODYSYNC_APP_ROOT);
  const resolvedRuntimeRoot = configuredRuntimeRootPath
    ? resolveMelodySyncRuntimeRoot(configuredRuntimeRootPath)
    : (MELODYSYNC_RUNTIME_ROOT || DEFAULT_MELODYSYNC_RUNTIME_ROOT);
  const resolvedAgentsPath = resolvedBrainRoot
    ? resolveMelodySyncDefaultAgentsPath(resolvedBrainRoot)
    : MELODYSYNC_AGENTS_FILE;
  if (!resolvedBrainRoot) {
    return {
      configuredBrainRootPath,
      configuredRuntimeRootPath,
      configuredAppRootPath: configuredBrainRootPath,
      brainRoot: '',
      runtimeRoot: '',
      appRoot: '',
      storagePath: GENERAL_SETTINGS_FILE,
      bootstrapStoragePath: GENERAL_SETTINGS_BOOTSTRAP_FILE,
      machineOverlayRoot: resolveMachineConfigRoot(),
      runtimeConfigRoot: '',
      emailPath: '',
      hooksPath: '',
      voicePath: '',
      sessionsPath: '',
      logsPath: '',
      memoryPath: '',
      workbenchPath: '',
      providerRuntimeHomesPath: '',
      customHooksPath: CUSTOM_HOOKS_FILE,
      agentsPath: resolvedAgentsPath,
      runtimeMode: 'split',
    };
  }
  const paths = buildPathsFromMetadata({
    brainRoot: resolvedBrainRoot,
    runtimeRoot: resolvedRuntimeRoot,
    agentsPath: resolvedAgentsPath,
  });
  return {
    configuredBrainRootPath,
    configuredRuntimeRootPath,
    configuredAppRootPath: configuredBrainRootPath,
    brainRoot: resolvedBrainRoot,
    runtimeRoot: resolvedRuntimeRoot,
    appRoot: resolvedBrainRoot,
    storagePath: paths.generalSettingsFile,
    bootstrapStoragePath: GENERAL_SETTINGS_BOOTSTRAP_FILE,
    machineOverlayRoot: paths.configDir,
    runtimeConfigRoot: paths.runtimeConfigDir,
    emailPath: paths.emailDir,
    hooksPath: paths.hooksDir,
    voicePath: paths.voiceDir,
    sessionsPath: paths.sessionsDir,
    logsPath: paths.logsDir,
    memoryPath: paths.memoryDir,
    workbenchPath: paths.workbenchDir,
    providerRuntimeHomesPath: paths.providerRuntimeHomesDir,
    customHooksPath: paths.customHooksFile,
    agentsPath: resolvedAgentsPath,
    runtimeMode: resolvedBrainRoot === resolvedRuntimeRoot ? 'unified' : 'split',
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

async function statOrNull(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

async function copyEntryIfMissing(sourcePath, targetPath) {
  if (!sourcePath || !targetPath || sourcePath === targetPath) return false;
  const [sourceStats, targetStats] = await Promise.all([
    statOrNull(sourcePath),
    statOrNull(targetPath),
  ]);
  if (!sourceStats || targetStats) return false;
  await ensureDir(dirname(targetPath));
  await cp(sourcePath, targetPath, {
    recursive: sourceStats.isDirectory(),
    force: false,
    errorOnExist: false,
    preserveTimestamps: true,
  });
  return true;
}

async function copyDirectoryContentsIfMissing(sourceDir, targetDir) {
  const sourceStats = await statOrNull(sourceDir);
  if (!sourceStats || !sourceStats.isDirectory()) return false;
  await ensureDir(targetDir);
  const entries = await readdir(sourceDir, { withFileTypes: true });
  let copied = false;
  for (const entry of entries) {
    const didCopy = await copyEntryIfMissing(
      resolve(sourceDir, entry.name),
      resolve(targetDir, entry.name),
    );
    copied = didCopy || copied;
  }
  return copied;
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

async function ensureStorageLayout(paths) {
  await ensureDir(paths.configDir);
  await ensureDir(paths.runtimeConfigDir);
  await ensureDir(paths.emailDir);
  await ensureDir(paths.hooksDir);
  await ensureDir(paths.voiceDir);
  await ensureDir(paths.voiceLogsDir);
  await ensureDir(paths.sessionsDir);
  await ensureDir(paths.workbenchDir);
  await ensureDir(paths.memoryDir);
  await ensureDir(paths.logsDir);
  await ensureDir(resolve(paths.memoryDir, 'tasks'));
}

async function migrateRootsIfNeeded(currentMetadata = null, nextMetadata = null) {
  if (!currentMetadata || !nextMetadata) return;
  const currentPaths = buildPathsFromMetadata(currentMetadata);
  const nextPaths = buildPathsFromMetadata(nextMetadata);

  if (currentMetadata.brainRoot && currentMetadata.brainRoot !== nextMetadata.brainRoot) {
    await copyEntryIfMissing(currentPaths.readmeFile, nextPaths.readmeFile);
    await copyEntryIfMissing(currentPaths.agentsFile, nextPaths.agentsFile);
    await copyDirectoryContentsIfMissing(currentPaths.memoryDir, nextPaths.memoryDir);
  }

  if (currentMetadata.runtimeRoot && currentMetadata.runtimeRoot !== nextMetadata.runtimeRoot) {
    await copyDirectoryContentsIfMissing(currentPaths.runtimeConfigDir, nextPaths.runtimeConfigDir);
    await copyDirectoryContentsIfMissing(currentPaths.emailDir, nextPaths.emailDir);
    await copyDirectoryContentsIfMissing(currentPaths.hooksDir, nextPaths.hooksDir);
    await copyDirectoryContentsIfMissing(currentPaths.voiceDir, nextPaths.voiceDir);
    await copyDirectoryContentsIfMissing(currentPaths.sessionsDir, nextPaths.sessionsDir);
    await copyDirectoryContentsIfMissing(currentPaths.workbenchDir, nextPaths.workbenchDir);
    await copyDirectoryContentsIfMissing(currentPaths.logsDir, nextPaths.logsDir);
  }
}

async function migrateLegacyBrainRuntimeIfNeeded(metadata = null) {
  if (!metadata?.brainRoot || !metadata?.runtimeRoot || metadata.brainRoot === metadata.runtimeRoot) {
    return;
  }

  const runtimePaths = buildPathsFromMetadata(metadata);
  const legacyBrainConfigDir = resolve(metadata.brainRoot, 'config');
  const legacyAppScopedSettings = normalizeAppScopedSettings(
    await readJson(resolve(legacyBrainConfigDir, 'general-settings.json'), DEFAULT_APP_SCOPED_SETTINGS),
  );
  const currentAppScopedSettings = normalizeAppScopedSettings(
    await readJson(runtimePaths.generalSettingsFile, DEFAULT_APP_SCOPED_SETTINGS),
  );
  if (!Object.keys(currentAppScopedSettings).length && Object.keys(legacyAppScopedSettings).length) {
    await writeJsonAtomic(runtimePaths.generalSettingsFile, legacyAppScopedSettings);
  }

  const runtimeConfigMappings = [
    ['provider-runtime-homes', runtimePaths.runtimeConfigDir + '/provider-runtime-homes'],
    ['hooks.json', runtimePaths.hooksFile],
    ['custom-hooks.json', runtimePaths.customHooksFile],
    ['workbench-node-settings.json', runtimePaths.workbenchNodeSettingsFile],
    ['workbench-capture-items.json', runtimePaths.workbenchCaptureItemsFile],
    ['workbench-projects.json', runtimePaths.workbenchProjectsFile],
    ['workbench-nodes.json', runtimePaths.workbenchNodesFile],
    ['workbench-branch-contexts.json', runtimePaths.workbenchBranchContextsFile],
    ['workbench-task-map-plans.json', runtimePaths.workbenchTaskMapPlansFile],
    ['workbench-skills.json', runtimePaths.workbenchSkillsFile],
    ['workbench-summaries.json', runtimePaths.workbenchSummariesFile],
  ];

  for (const [relativePath, targetPath] of runtimeConfigMappings) {
    await copyEntryIfMissing(resolve(legacyBrainConfigDir, relativePath), targetPath);
  }

  await copyDirectoryContentsIfMissing(resolve(metadata.brainRoot, 'email'), runtimePaths.emailDir);
  await copyDirectoryContentsIfMissing(resolve(metadata.brainRoot, 'hooks'), runtimePaths.hooksDir);
  await copyDirectoryContentsIfMissing(resolve(metadata.brainRoot, 'voice'), runtimePaths.voiceDir);
  await copyDirectoryContentsIfMissing(resolve(metadata.brainRoot, 'sessions'), runtimePaths.sessionsDir);
  await copyDirectoryContentsIfMissing(resolve(metadata.brainRoot, 'workbench'), runtimePaths.workbenchDir);
  await copyDirectoryContentsIfMissing(resolve(metadata.brainRoot, 'logs'), runtimePaths.logsDir);
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
    taskListTemplateGroups: Array.isArray(appScoped.taskListTemplateGroups)
      ? appScoped.taskListTemplateGroups.slice()
      : [],
    ...bootstrapNormalized,
    ...metadata,
  };
}

export async function persistGeneralSettings(payload = {}) {
  const current = await readGeneralSettings();
  const normalized = normalizeGeneralSettings(payload);
  const metadata = deriveGeneralSettingsMetadata(normalized);
  for (const targetPath of [metadata.brainRoot, metadata.runtimeRoot]) {
    if (targetPath && !(await isDirectoryPath(targetPath))) {
      await ensureDir(targetPath);
      if (!(await isDirectoryPath(targetPath))) {
        throw new Error('应用路径不存在或不是目录');
      }
    }
  }
  const paths = buildPathsFromMetadata(metadata);
  await ensureStorageLayout(paths);
  await migrateRootsIfNeeded(current, metadata);
  await migrateLegacyBrainRuntimeIfNeeded(metadata);
  await writeJsonAtomic(GENERAL_SETTINGS_BOOTSTRAP_FILE, {
    brainRoot: metadata.brainRoot,
    runtimeRoot: metadata.runtimeRoot,
    appRoot: metadata.brainRoot,
  });
  const appScopedPayload = normalizeAppScopedSettings(payload);
  await writeJsonAtomic(paths.generalSettingsFile, appScopedPayload);
  await ensureAgentsFile(metadata.agentsPath);
  await ensureHooksFile(paths.customHooksFile);

  const completionSoundEnabled = readCompletionSoundEnabled(payload);
  return {
    completionSoundEnabled: completionSoundEnabled === null
      ? DEFAULT_COMPLETION_SOUND_ENABLED
      : completionSoundEnabled,
    taskListTemplateGroups: Array.isArray(appScopedPayload.taskListTemplateGroups)
      ? appScopedPayload.taskListTemplateGroups.slice()
      : [],
    ...normalized,
    ...metadata,
  };
}

export async function ensureGeneralSettingsRuntimeFiles() {
  const current = await readGeneralSettings();
  const metadata = deriveGeneralSettingsMetadata(current);
  const paths = buildPathsFromMetadata(metadata);
  await ensureStorageLayout(paths);
  await migrateLegacyBrainRuntimeIfNeeded(metadata);
  const appScopedPayload = await readJson(paths.generalSettingsFile, DEFAULT_APP_SCOPED_SETTINGS);
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
    brainRoot: DEFAULT_SETTINGS.brainRoot,
    runtimeRoot: DEFAULT_SETTINGS.runtimeRoot,
    appRoot: DEFAULT_SETTINGS.appRoot,
    completionSoundEnabled: DEFAULT_COMPLETION_SOUND_ENABLED,
    ...metadata,
  };
}
