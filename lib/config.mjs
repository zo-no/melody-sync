import { homedir } from 'os';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { cp, mkdir, readdir, stat, writeFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PROJECT_ROOT = process.env.MELODYSYNC_SOURCE_PROJECT_ROOT || join(__dirname, '..');
const SOURCE_PROJECT_ENV_FILES = Object.freeze(['.env', '.env.local']);

export const DEFAULT_OBSIDIAN_VAULT_DIR = '';
export const MELODYSYNC_APP_ROOT_NAME = '.melodysync';
export const MELODYSYNC_APP_ROOT_SEGMENTS = Object.freeze([MELODYSYNC_APP_ROOT_NAME]);
export const MELODYSYNC_AGENT_WORKSPACE_DIRNAME = '00-🤖agent';
export const MELODYSYNC_LEGACY_VISIBLE_APP_ROOT_SEGMENTS = Object.freeze(['00-agents', 'melody-sync']);
export const MELODYSYNC_AGENTS_FILENAME = 'AGENTS.md';
export const DEFAULT_MELODYSYNC_APP_ROOT = join(homedir(), MELODYSYNC_APP_ROOT_NAME);
export const DEFAULT_MELODYSYNC_RUNTIME_ROOT = join(DEFAULT_MELODYSYNC_APP_ROOT, 'runtime');

function validPort(val, fallback) {
  const n = parseInt(val, 10);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : fallback;
}

function validMs(val, min, max, fallback) {
  const n = parseInt(val, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function validInt(val, min, max, fallback) {
  const n = parseInt(val, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function unescapeDotEnvQuotedValue(value, quote) {
  if (quote === "'") {
    return value.replace(/\\'/g, "'");
  }
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function parseDotEnvValue(rawValue) {
  const trimmed = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!trimmed) return '';
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return unescapeDotEnvQuotedValue(trimmed.slice(1, -1), quote);
  }
  const commentIndex = trimmed.search(/\s+#/);
  return (commentIndex >= 0 ? trimmed.slice(0, commentIndex) : trimmed).trim();
}

function loadDotEnvFile(dotEnvPath, loadedKeys) {
  if (!existsSync(dotEnvPath)) return false;
  let content = '';
  try {
    content = readFileSync(dotEnvPath, 'utf8');
  } catch {
    return false;
  }

  let loaded = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;
    const line = trimmedLine.startsWith('export ')
      ? trimmedLine.slice('export '.length).trim()
      : trimmedLine;
    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(process.env, key) && !loadedKeys.has(key)) {
      continue;
    }
    const value = parseDotEnvValue(line.slice(equalsIndex + 1));
    process.env[key] = value;
    loadedKeys.add(key);
    loaded = true;
  }
  return loaded;
}

function loadProjectEnvFiles() {
  const loadedKeys = new Set();
  for (const envFileName of SOURCE_PROJECT_ENV_FILES) {
    loadDotEnvFile(join(SOURCE_PROJECT_ROOT, envFileName), loadedKeys);
  }
}

loadProjectEnvFiles();

function resolveOverridePath(value) {
  const trimmed = trimString(value);
  if (!trimmed) return '';
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function normalizeBaseUrl(value) {
  const trimmed = trimString(value);
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function extractOrigin(value) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return '';
  try {
    return new URL(normalized).origin;
  } catch {
    return '';
  }
}

function readJsonFileSync(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
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
  await mkdir(dirname(targetPath), { recursive: true });
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
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  let copied = false;
  for (const entry of entries) {
    const didCopy = await copyEntryIfMissing(
      join(sourceDir, entry.name),
      join(targetDir, entry.name),
    );
    copied = didCopy || copied;
  }
  return copied;
}

async function writeTextIfMissing(path, value) {
  if (existsSync(path)) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, 'utf8');
}

function resolveMelodySyncAppRoot(vaultPath) {
  const normalizedVaultPath = resolveOverridePath(vaultPath);
  if (!normalizedVaultPath) return '';
  return normalizedVaultPath;
}

function resolveMelodySyncLegacyVaultRoot(vaultPath) {
  const normalizedVaultPath = resolveOverridePath(vaultPath);
  return normalizedVaultPath ? join(normalizedVaultPath, '.melody-sync') : '';
}

function resolveMelodySyncLegacyVisibleVaultRoot(vaultPath) {
  const normalizedVaultPath = resolveOverridePath(vaultPath);
  return normalizedVaultPath ? join(normalizedVaultPath, ...MELODYSYNC_LEGACY_VISIBLE_APP_ROOT_SEGMENTS) : '';
}

function resolveMelodySyncDefaultAgentsPath(vaultPath) {
  const appRoot = resolveMelodySyncAppRoot(vaultPath);
  if (!appRoot) return '';
  return join(appRoot, MELODYSYNC_AGENTS_FILENAME);
}

function resolveMelodySyncRuntimeRoot(runtimePath) {
  const normalizedRuntimePath = resolveOverridePath(runtimePath);
  return normalizedRuntimePath || DEFAULT_MELODYSYNC_RUNTIME_ROOT;
}

function normalizeConfiguredAgentsPath(value, storageRootPath) {
  const resolvedPath = resolveOverridePath(value);
  if (!resolvedPath) return '';
  const defaultAgentsPath = storageRootPath
    ? join(resolveMelodySyncAppRoot(storageRootPath), MELODYSYNC_AGENTS_FILENAME)
    : '';
  const legacyHiddenAgentsPath = storageRootPath
    ? join(resolveMelodySyncLegacyVaultRoot(storageRootPath), MELODYSYNC_AGENTS_FILENAME)
    : '';
  const legacyVisibleAgentsPath = storageRootPath
    ? join(resolveMelodySyncLegacyVisibleVaultRoot(storageRootPath), MELODYSYNC_AGENTS_FILENAME)
    : '';
  return resolvedPath === defaultAgentsPath
    || resolvedPath === legacyHiddenAgentsPath
    || resolvedPath === legacyVisibleAgentsPath
    ? ''
    : resolvedPath;
}

function buildMelodySyncPaths(rootOrOptions, options = {}) {
  const legacyRoot = typeof rootOrOptions === 'string' ? rootOrOptions : '';
  const spec = legacyRoot
    ? {
      brainRoot: legacyRoot,
      runtimeRoot: options.runtimeRoot || legacyRoot,
      machineConfigRoot: options.machineConfigRoot || join(resolveOverridePath(legacyRoot), 'config'),
      agentsFile: options.agentsFile,
    }
    : (rootOrOptions && typeof rootOrOptions === 'object' ? rootOrOptions : {});
  const brainRoot = resolveOverridePath(spec.brainRoot || spec.appRoot || spec.root);
  const runtimeRoot = resolveMelodySyncRuntimeRoot(spec.runtimeRoot || spec.runtime?.root);
  const machineConfigRoot = resolveOverridePath(
    spec.machineConfigRoot
    || spec.machineOverlayRoot
    || spec.configRoot,
  ) || join(runtimeRoot, 'machine-config');
  const agentsFile = resolveOverridePath(spec.agentsFile) || join(brainRoot, MELODYSYNC_AGENTS_FILENAME);
  const runtimeConfigDir = join(runtimeRoot, 'config');
  const providerRuntimeHomesDir = join(runtimeConfigDir, 'provider-runtime-homes');
  const configDir = machineConfigRoot;
  const emailDir = join(runtimeRoot, 'email');
  const hooksDir = join(runtimeRoot, 'hooks');
  const voiceDir = join(runtimeRoot, 'voice');
  const voiceLogsDir = join(voiceDir, 'logs');
  const sessionsDir = join(runtimeRoot, 'sessions');
  const workbenchDir = join(runtimeRoot, 'workbench');
  const memoryDir = join(brainRoot, 'memory');
  const logsDir = join(runtimeRoot, 'logs');
  return {
    root: brainRoot,
    brainRoot,
    runtimeRoot,
    machineConfigRoot,
    runtimeConfigDir,
    providerRuntimeHomesDir,
    agentsFile,
    configDir,
    emailDir,
    hooksDir,
    voiceDir,
    voiceLogsDir,
    sessionsDir,
    workbenchDir,
    memoryDir,
    logsDir,
    readmeFile: join(brainRoot, 'README.md'),
    authFile: join(configDir, 'auth.json'),
    toolsFile: join(configDir, 'tools.json'),
    authSessionsFile: join(configDir, 'auth-sessions.json'),
    generalSettingsFile: join(runtimeConfigDir, 'general-settings.json'),
    vapidKeysFile: join(configDir, 'vapid-keys.json'),
    pushSubscriptionsFile: join(configDir, 'push-subscriptions.json'),
    uiRuntimeSelectionFile: join(configDir, 'ui-runtime-selection.json'),
    codexManagedHomeDir: join(providerRuntimeHomesDir, 'codex'),
    hooksFile: join(hooksDir, 'settings.json'),
    customHooksFile: join(hooksDir, 'custom-hooks.json'),
    voiceConfigFile: join(voiceDir, 'config.json'),
    voiceEventsLogFile: join(voiceDir, 'events.jsonl'),
    voiceConnectorPidFile: join(voiceDir, 'connector.pid'),
    voiceRuntimeLogFile: join(voiceLogsDir, 'connector.log'),
    voiceLauncherFile: join(voiceDir, 'start-connector-terminal.sh'),
    chatSessionsFile: join(sessionsDir, 'chat-sessions.json'),
    chatSessionsIndexFile: join(sessionsDir, 'SESSIONS.md'),
    chatHistoryDir: join(sessionsDir, 'history'),
    chatRunsDir: join(sessionsDir, 'runs'),
    chatImagesDir: join(sessionsDir, 'images'),
    chatFileAssetsDir: join(sessionsDir, 'file-assets'),
    chatFileAssetCacheDir: join(sessionsDir, 'file-assets-cache'),
    apiRequestLogsDir: join(logsDir, 'api'),
    workbenchNodeSettingsFile: join(workbenchDir, 'node-settings.json'),
    workbenchCaptureItemsFile: join(workbenchDir, 'capture-items.json'),
    workbenchProjectsFile: join(workbenchDir, 'projects.json'),
    workbenchNodesFile: join(workbenchDir, 'nodes.json'),
    workbenchBranchContextsFile: join(workbenchDir, 'branch-contexts.json'),
    workbenchTaskMapPlansFile: join(workbenchDir, 'task-map-plans.json'),
    workbenchMemoryCandidatesFile: join(workbenchDir, 'memory-candidates.json'),
    workbenchSkillsFile: join(workbenchDir, 'skills.json'),
    workbenchSummariesFile: join(workbenchDir, 'summaries.json'),
  };
}

function buildDefaultAgentsContent() {
  return `# MelodySync AGENTS

这是 MelodySync 在当前大脑目录中的用户可编辑 agent 说明文件。

## 默认角色

- 这个文件负责告诉 agent：如何理解当前本地知识库/工作区，以及 MelodySync 在其中扮演什么角色。
- 这个目录只承载可迁移的长期记忆、说明和协作边界。
- 会话、运行记录、日志、provider 原始数据等运行态信息不默认保存在这里。
- 如果当前大脑目录本身位于某个知识库、仓库或同步目录里，那么这个文件可以进一步告诉 agent 如何管理更大的工作区。

## 推荐读取顺序

1. 先读本文件，确认当前知识库/工作区的管理边界
2. 再读 \`memory/bootstrap.md\`
3. 按需读 \`memory/projects.md\`、\`memory/skills.md\`
4. 任务明确后再读 \`memory/tasks/\` 和当前工作区中相关项目文件

## 当前大脑目录内的长期内容

- 记忆：\`memory/\`
- 说明文件：\`AGENTS.md\`
- 其他长期协作材料：按需放在本目录内

## 自定义 Hooks

- 自定义 hook 和运行态目录位于本机 runtime root，不默认跟随大脑同步。
- 这里更适合记录哪些自动化应该存在、哪些 Hook 需要启用，而不是直接把运行日志写进来。

## 如果当前大脑目录位于更大的知识库或 vault 中

- 顶层分区由人类知识组织决定，agent 需要遵守现有目录语义。
- MelodySync 不应该把运行态业务数据散落到各个知识目录里；长期知识留在这里，运行态留在本机 runtime root。
- 需要管理更大的工作区时，由本文件明确各个顶层目录的用途、可写边界和默认读取顺序。

## 备注

- 这个文件所在的大脑目录可以在 MelodySync 的通用设置里修改。
- 你可以直接编辑这个文件，告诉 agent 默认应读取哪些 MelodySync 文件、如何理解整个本地知识库，以及需要遵守哪些本地规则。
`;
}

function readConfiguredBootstrapSettings(bootstrapSettingsFile) {
  const envOverride = resolveOverridePath(
    process.env.MELODYSYNC_OBSIDIAN_VAULT_DIR || process.env.MELODYSYNC_OBSIDIAN_PATH,
  );
  if (envOverride) {
    return {
      brainRootPath: envOverride,
      runtimeRootPath: resolveOverridePath(process.env.MELODYSYNC_RUNTIME_ROOT),
      agentsPath: '',
    };
  }
  const payload = readJsonFileSync(bootstrapSettingsFile, null);
  const brainRootPath = resolveOverridePath(
    payload?.brainRoot
    || payload?.brain?.root
    || payload?.appRoot
    || payload?.appRootPath
    || payload?.app?.root,
  );
  return {
    brainRootPath,
    runtimeRootPath: resolveOverridePath(payload?.runtimeRoot || payload?.runtime?.root),
    agentsPath: normalizeConfiguredAgentsPath(
      payload?.agentsPath || payload?.agentPath || payload?.agents?.path,
      brainRootPath,
    ),
  };
}

async function ensureMelodySyncVaultScaffold(paths) {
  await mkdir(paths.brainRoot, { recursive: true });
  await mkdir(paths.runtimeRoot, { recursive: true });
  await mkdir(paths.configDir, { recursive: true });
  for (const dir of [
    paths.runtimeConfigDir,
    paths.emailDir,
    paths.hooksDir,
    paths.voiceDir,
    paths.voiceLogsDir,
    paths.sessionsDir,
    paths.workbenchDir,
    paths.memoryDir,
    join(paths.memoryDir, 'tasks'),
    paths.logsDir,
  ]) {
    await mkdir(dir, { recursive: true });
  }
  await writeTextIfMissing(
    paths.readmeFile,
    `# MelodySync Brain Root

这个目录是 MelodySync 的可迁移大脑目录。

- \`AGENTS.md\`：协作边界与默认读取规则
- \`memory/\`：启动记忆、项目索引、技能索引、任务记忆
- 这里适合放用户认可的长期设置、偏好、习惯、项目背景

运行态数据（例如 sessions、runs、logs、provider raw capture）不默认保存在这里，而是保存在本机 runtime root。
`,
  );
  await writeTextIfMissing(paths.agentsFile, buildDefaultAgentsContent());
  await writeTextIfMissing(
    join(paths.hooksDir, 'README.md'),
    `# MelodySync Hooks

- \`settings.json\`：当前 Hook 启停状态
- \`custom-hooks.json\`：预留给后续自定义 Hook 设计/声明使用

自定义 Hook 当前使用 JSON 数组：

\`\`\`json
[
  {
    "id": "custom.open-obsidian",
    "eventPattern": "instance.startup",
    "label": "启动时打开 Obsidian",
    "shellCommand": "open -a Obsidian \\"$MELODYSYNC_APP_ROOT\\"",
    "runInBackground": true
  }
]
\`\`\`

如果你把大脑目录放在同步盘里，长期协作说明可以同步；运行态仍留在本机 runtime root。
`,
  );
}

async function migrateLegacyStorageToVault(paths, options = {}) {
  if (!options.useVaultStorage) return;
  const currentSplitBrainRoot = (
    paths?.brainRoot
    && paths?.runtimeRoot
    && resolveOverridePath(paths.brainRoot) !== resolveOverridePath(paths.runtimeRoot)
  ) ? paths.brainRoot : '';
  const legacyVaultRoots = [...new Set([
    currentSplitBrainRoot,
    ...(Array.isArray(options.legacyVaultRoots) ? options.legacyVaultRoots : []),
  ].map((entry) => resolveOverridePath(entry)).filter(Boolean))];
  const configCandidates = [
    options.bootstrapConfigDir,
    options.defaultUserConfigDir,
    options.legacyUserConfigDir,
  ].filter(Boolean);
  const memoryCandidates = [
    options.defaultUserMemoryDir,
    options.legacyUserMemoryDir,
  ].filter(Boolean);

  const machineConfigMappings = [
    ['auth.json', paths.authFile],
    ['tools.json', paths.toolsFile],
    ['auth-sessions.json', paths.authSessionsFile],
    ['vapid-keys.json', paths.vapidKeysFile],
    ['push-subscriptions.json', paths.pushSubscriptionsFile],
    ['ui-runtime-selection.json', paths.uiRuntimeSelectionFile],
  ];

  const runtimeConfigMappings = [
    ['general-settings.json', paths.generalSettingsFile],
    ['provider-runtime-homes', paths.providerRuntimeHomesDir],
    ['hooks.json', paths.hooksFile],
    ['custom-hooks.json', paths.customHooksFile],
    ['workbench-node-settings.json', paths.workbenchNodeSettingsFile],
    ['workbench-capture-items.json', paths.workbenchCaptureItemsFile],
    ['workbench-projects.json', paths.workbenchProjectsFile],
    ['workbench-nodes.json', paths.workbenchNodesFile],
    ['workbench-branch-contexts.json', paths.workbenchBranchContextsFile],
    ['workbench-task-map-plans.json', paths.workbenchTaskMapPlansFile],
    ['workbench-skills.json', paths.workbenchSkillsFile],
    ['workbench-summaries.json', paths.workbenchSummariesFile],
  ];

  for (const [relativePath, targetPath] of machineConfigMappings) {
    for (const candidateDir of configCandidates) {
      if (await copyEntryIfMissing(join(candidateDir, relativePath), targetPath)) {
        break;
      }
    }
  }

  for (const [relativePath, targetPath] of runtimeConfigMappings) {
    for (const candidateDir of configCandidates) {
      if (await copyEntryIfMissing(join(candidateDir, relativePath), targetPath)) {
        break;
      }
    }
  }

  for (const candidateDir of memoryCandidates) {
    if (await copyDirectoryContentsIfMissing(candidateDir, paths.memoryDir)) {
      break;
    }
  }

  for (const legacyVaultRoot of legacyVaultRoots) {
    if (!legacyVaultRoot) continue;
    const legacyConfigDir = join(legacyVaultRoot, 'config');
    for (const [relativePath, targetPath] of machineConfigMappings) {
      await copyEntryIfMissing(join(legacyConfigDir, relativePath), targetPath);
    }
    for (const [relativePath, targetPath] of runtimeConfigMappings) {
      await copyEntryIfMissing(join(legacyConfigDir, relativePath), targetPath);
    }
    await copyDirectoryContentsIfMissing(join(legacyVaultRoot, 'email'), paths.emailDir);
    await copyDirectoryContentsIfMissing(join(legacyVaultRoot, 'hooks'), paths.hooksDir);
    await copyDirectoryContentsIfMissing(join(legacyVaultRoot, 'voice'), paths.voiceDir);
    await copyDirectoryContentsIfMissing(join(legacyVaultRoot, 'sessions'), paths.sessionsDir);
    await copyDirectoryContentsIfMissing(join(legacyVaultRoot, 'workbench'), paths.workbenchDir);
    await copyDirectoryContentsIfMissing(join(legacyVaultRoot, 'memory'), paths.memoryDir);
    await copyDirectoryContentsIfMissing(join(legacyVaultRoot, 'logs'), paths.logsDir);
    await copyEntryIfMissing(join(legacyVaultRoot, 'README.md'), paths.readmeFile);
    await copyEntryIfMissing(join(legacyVaultRoot, MELODYSYNC_AGENTS_FILENAME), paths.agentsFile);
  }
}

export const SESSION_EXPIRY = validMs(
  process.env.SESSION_EXPIRY,
  60 * 1000,
  30 * 24 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
);
export const SECURE_COOKIES = process.env.SECURE_COOKIES !== '0';

export const INSTANCE_ROOT = resolveOverridePath(process.env.MELODYSYNC_INSTANCE_ROOT) || null;
const explicitConfigOverride = resolveOverridePath(process.env.MELODYSYNC_CONFIG_DIR);
const explicitMemoryOverride = resolveOverridePath(process.env.MELODYSYNC_MEMORY_DIR);
const explicitRuntimeOverride = resolveOverridePath(process.env.MELODYSYNC_RUNTIME_ROOT);
const defaultUserConfigDir = join(homedir(), '.config', 'melody-sync');
const defaultUserAppRoot = DEFAULT_MELODYSYNC_APP_ROOT;
const defaultUserRuntimeRoot = DEFAULT_MELODYSYNC_RUNTIME_ROOT;
const legacyUserConfigDir = '';
const defaultUserMemoryDir = join(defaultUserAppRoot, 'memory');
const legacyUserAppRoot = join(homedir(), '.melody-sync');
const legacyUserMemoryDir = join(legacyUserAppRoot, 'memory');
const inferredUserConfigDir = defaultUserConfigDir;
export const BOOTSTRAP_CONFIG_DIR = explicitConfigOverride
  || (INSTANCE_ROOT ? join(INSTANCE_ROOT, 'config') : inferredUserConfigDir);
export const GENERAL_SETTINGS_BOOTSTRAP_FILE = join(BOOTSTRAP_CONFIG_DIR, 'general-settings.json');
const bootstrapGeneralSettings = readConfiguredBootstrapSettings(GENERAL_SETTINGS_BOOTSTRAP_FILE);
export const OBSIDIAN_VAULT_DIR = bootstrapGeneralSettings.brainRootPath;
export const USE_APP_ROOT_STORAGE = !explicitConfigOverride && !explicitMemoryOverride && !INSTANCE_ROOT;
export const USE_OBSIDIAN_VAULT_STORAGE = USE_APP_ROOT_STORAGE && !!OBSIDIAN_VAULT_DIR;
export const MELODYSYNC_BRAIN_ROOT = USE_APP_ROOT_STORAGE
  ? (resolveMelodySyncAppRoot(OBSIDIAN_VAULT_DIR) || defaultUserAppRoot)
  : '';
export const MELODYSYNC_APP_ROOT = MELODYSYNC_BRAIN_ROOT;
export const MELODYSYNC_RUNTIME_ROOT = explicitRuntimeOverride
  || (USE_APP_ROOT_STORAGE
    ? resolveMelodySyncRuntimeRoot(bootstrapGeneralSettings.runtimeRootPath)
    : (INSTANCE_ROOT ? join(INSTANCE_ROOT, 'runtime') : defaultUserRuntimeRoot));
export const MELODYSYNC_LEGACY_VAULT_ROOT = USE_APP_ROOT_STORAGE
  ? resolveMelodySyncLegacyVaultRoot(OBSIDIAN_VAULT_DIR || MELODYSYNC_APP_ROOT)
  : '';
export const MELODYSYNC_LEGACY_VISIBLE_VAULT_ROOT = USE_APP_ROOT_STORAGE
  ? resolveMelodySyncLegacyVisibleVaultRoot(OBSIDIAN_VAULT_DIR || MELODYSYNC_APP_ROOT)
  : '';
export const MELODYSYNC_LEGACY_NESTED_APP_ROOT = USE_APP_ROOT_STORAGE
  ? join(MELODYSYNC_APP_ROOT, MELODYSYNC_APP_ROOT_NAME)
  : '';
const defaultVaultAgentsFile = USE_APP_ROOT_STORAGE
  ? resolveMelodySyncDefaultAgentsPath(MELODYSYNC_APP_ROOT)
  : '';
const configuredVaultAgentsFile = USE_APP_ROOT_STORAGE
  ? (bootstrapGeneralSettings.agentsPath || defaultVaultAgentsFile)
  : '';
const vaultPaths = USE_APP_ROOT_STORAGE
  ? buildMelodySyncPaths({
    brainRoot: MELODYSYNC_APP_ROOT,
    runtimeRoot: MELODYSYNC_RUNTIME_ROOT,
    machineConfigRoot: BOOTSTRAP_CONFIG_DIR,
    agentsFile: configuredVaultAgentsFile,
  })
  : null;
export const CONFIG_DIR = explicitConfigOverride || (INSTANCE_ROOT ? join(INSTANCE_ROOT, 'config') : inferredUserConfigDir);
export const MELODYSYNC_DEFAULT_AGENTS_FILE = USE_APP_ROOT_STORAGE
  ? defaultVaultAgentsFile
  : join(CONFIG_DIR, MELODYSYNC_AGENTS_FILENAME);
export const MELODYSYNC_CONFIGURED_AGENTS_FILE = USE_APP_ROOT_STORAGE
  ? configuredVaultAgentsFile
  : join(CONFIG_DIR, MELODYSYNC_AGENTS_FILENAME);
export const RUNTIME_CONFIG_DIR = USE_APP_ROOT_STORAGE
  ? vaultPaths.runtimeConfigDir
  : join(MELODYSYNC_RUNTIME_ROOT, 'config');

export const MEMORY_DIR = explicitMemoryOverride
  || (INSTANCE_ROOT ? join(INSTANCE_ROOT, 'memory') : (USE_APP_ROOT_STORAGE ? vaultPaths.memoryDir : defaultUserMemoryDir));

await mkdir(CONFIG_DIR, { recursive: true });

if (USE_APP_ROOT_STORAGE && vaultPaths) {
  await ensureMelodySyncVaultScaffold(vaultPaths);
  await migrateLegacyStorageToVault(vaultPaths, {
    useVaultStorage: USE_APP_ROOT_STORAGE,
    bootstrapConfigDir: BOOTSTRAP_CONFIG_DIR,
    defaultUserConfigDir,
    legacyUserConfigDir,
    defaultUserMemoryDir,
    legacyUserMemoryDir,
    legacyVaultRoots: [
      legacyUserAppRoot,
      MELODYSYNC_LEGACY_VAULT_ROOT,
      MELODYSYNC_LEGACY_VISIBLE_VAULT_ROOT,
      MELODYSYNC_LEGACY_NESTED_APP_ROOT,
    ],
  });
  await writeTextIfMissing(vaultPaths.customHooksFile, '[]\n');
}

export const CHAT_PORT = validPort(process.env.CHAT_PORT, 7760);
export const CHAT_BIND_HOST = process.env.CHAT_BIND_HOST || '127.0.0.1';

export const AUTH_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.authFile : join(CONFIG_DIR, 'auth.json');
export const TOOLS_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.toolsFile : join(CONFIG_DIR, 'tools.json');
export const AUTH_SESSIONS_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.authSessionsFile : join(CONFIG_DIR, 'auth-sessions.json');
export const CHAT_SESSIONS_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.chatSessionsFile : join(CONFIG_DIR, 'chat-sessions.json');
export const CHAT_SESSIONS_INDEX_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.chatSessionsIndexFile : join(CONFIG_DIR, 'SESSIONS.md');
export const CHAT_HISTORY_DIR = USE_APP_ROOT_STORAGE ? vaultPaths.chatHistoryDir : join(CONFIG_DIR, 'chat-history');
export const CHAT_RUNS_DIR = USE_APP_ROOT_STORAGE ? vaultPaths.chatRunsDir : join(CONFIG_DIR, 'chat-runs');
export const CHAT_IMAGES_DIR = USE_APP_ROOT_STORAGE ? vaultPaths.chatImagesDir : join(CONFIG_DIR, 'images');
export const CHAT_FILE_ASSETS_DIR = USE_APP_ROOT_STORAGE ? vaultPaths.chatFileAssetsDir : join(CONFIG_DIR, 'file-assets');
export const CHAT_FILE_ASSET_CACHE_DIR = USE_APP_ROOT_STORAGE ? vaultPaths.chatFileAssetCacheDir : join(CONFIG_DIR, 'file-assets-cache');
export const API_REQUEST_LOGS_DIR = USE_APP_ROOT_STORAGE ? vaultPaths.apiRequestLogsDir : join(CONFIG_DIR, 'api-logs');
export const VAPID_KEYS_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.vapidKeysFile : join(CONFIG_DIR, 'vapid-keys.json');
export const PUSH_SUBSCRIPTIONS_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.pushSubscriptionsFile : join(CONFIG_DIR, 'push-subscriptions.json');
export const HOOKS_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.hooksFile : join(CONFIG_DIR, 'hooks.json');
export const CUSTOM_HOOKS_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.customHooksFile : join(CONFIG_DIR, 'custom-hooks.json');
export const GENERAL_SETTINGS_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.generalSettingsFile : join(CONFIG_DIR, 'general-settings.json');
export const VOICE_DIR = USE_APP_ROOT_STORAGE ? vaultPaths.voiceDir : join(CONFIG_DIR, 'voice');
export const VOICE_LOGS_DIR = USE_APP_ROOT_STORAGE ? vaultPaths.voiceLogsDir : join(VOICE_DIR, 'logs');
export const VOICE_CONFIG_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.voiceConfigFile : join(VOICE_DIR, 'config.json');
export const VOICE_EVENTS_LOG_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.voiceEventsLogFile : join(VOICE_DIR, 'events.jsonl');
export const VOICE_CONNECTOR_PID_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.voiceConnectorPidFile : join(VOICE_DIR, 'connector.pid');
export const VOICE_RUNTIME_LOG_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.voiceRuntimeLogFile : join(VOICE_LOGS_DIR, 'connector.log');
export const VOICE_LAUNCHER_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.voiceLauncherFile : join(VOICE_DIR, 'start-connector-terminal.sh');
export const WORKBENCH_NODE_SETTINGS_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.workbenchNodeSettingsFile : join(CONFIG_DIR, 'workbench-node-settings.json');
export const WORKBENCH_CAPTURE_ITEMS_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.workbenchCaptureItemsFile : join(CONFIG_DIR, 'workbench-capture-items.json');
export const WORKBENCH_PROJECTS_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.workbenchProjectsFile : join(CONFIG_DIR, 'workbench-projects.json');
export const WORKBENCH_NODES_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.workbenchNodesFile : join(CONFIG_DIR, 'workbench-nodes.json');
export const WORKBENCH_BRANCH_CONTEXTS_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.workbenchBranchContextsFile : join(CONFIG_DIR, 'workbench-branch-contexts.json');
export const WORKBENCH_TASK_MAP_PLANS_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.workbenchTaskMapPlansFile : join(CONFIG_DIR, 'workbench-task-map-plans.json');
export const WORKBENCH_MEMORY_CANDIDATES_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.workbenchMemoryCandidatesFile : join(CONFIG_DIR, 'workbench-memory-candidates.json');
export const WORKBENCH_SKILLS_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.workbenchSkillsFile : join(CONFIG_DIR, 'workbench-skills.json');
export const WORKBENCH_SUMMARIES_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.workbenchSummariesFile : join(CONFIG_DIR, 'workbench-summaries.json');
export const UI_RUNTIME_SELECTION_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.uiRuntimeSelectionFile : join(CONFIG_DIR, 'ui-runtime-selection.json');
export const CODEX_MANAGED_HOME_DIR = USE_APP_ROOT_STORAGE ? vaultPaths.codexManagedHomeDir : join(CONFIG_DIR, 'provider-runtime-homes', 'codex');
export const MELODYSYNC_AGENTS_FILE = USE_APP_ROOT_STORAGE ? vaultPaths.agentsFile : join(CONFIG_DIR, MELODYSYNC_AGENTS_FILENAME);

export const FILE_ASSET_STORAGE_BASE_URL = normalizeBaseUrl(process.env.MELODYSYNC_ASSET_STORAGE_BASE_URL);
export const FILE_ASSET_PUBLIC_BASE_URL = normalizeBaseUrl(process.env.MELODYSYNC_ASSET_STORAGE_PUBLIC_BASE_URL);
export const FILE_ASSET_STORAGE_REGION = trimString(process.env.MELODYSYNC_ASSET_STORAGE_REGION) || 'auto';
export const FILE_ASSET_STORAGE_ACCESS_KEY_ID = trimString(process.env.MELODYSYNC_ASSET_STORAGE_ACCESS_KEY_ID);
export const FILE_ASSET_STORAGE_SECRET_ACCESS_KEY = trimString(process.env.MELODYSYNC_ASSET_STORAGE_SECRET_ACCESS_KEY);
export const FILE_ASSET_STORAGE_KEY_PREFIX = (trimString(process.env.MELODYSYNC_ASSET_STORAGE_KEY_PREFIX) || 'session-assets')
  .replace(/^\/+/, '')
  .replace(/\/+$/, '');
export const FILE_ASSET_STORAGE_PRESIGN_TTL_SECONDS = validInt(
  process.env.MELODYSYNC_ASSET_STORAGE_PRESIGN_TTL_SECONDS,
  60,
  7 * 24 * 60 * 60,
  60 * 60,
);
export const FILE_ASSET_STORAGE_ENABLED = !!(
  FILE_ASSET_STORAGE_BASE_URL
  && FILE_ASSET_STORAGE_ACCESS_KEY_ID
  && FILE_ASSET_STORAGE_SECRET_ACCESS_KEY
  && FILE_ASSET_STORAGE_REGION
);
export const FILE_ASSET_ALLOWED_ORIGINS = [...new Set([
  extractOrigin(FILE_ASSET_STORAGE_BASE_URL),
  extractOrigin(FILE_ASSET_PUBLIC_BASE_URL),
].filter(Boolean))];

export const SYSTEM_MEMORY_DIR = join(SOURCE_PROJECT_ROOT, 'memory');

export const MEMORY_STORE_FILE = explicitMemoryOverride
  ? join(explicitMemoryOverride, 'memory-store.jsonl')
  : (INSTANCE_ROOT ? join(INSTANCE_ROOT, 'memory', 'memory-store.jsonl') : (USE_APP_ROOT_STORAGE ? join(vaultPaths?.memoryDir || defaultUserMemoryDir, 'memory-store.jsonl') : join(defaultUserMemoryDir, 'memory-store.jsonl')));

export {
  buildMelodySyncPaths,
  buildDefaultAgentsContent,
  resolveMelodySyncAppRoot,
  resolveMelodySyncRuntimeRoot,
  resolveMelodySyncLegacyVaultRoot,
  resolveMelodySyncLegacyVisibleVaultRoot,
  resolveMelodySyncDefaultAgentsPath,
};
