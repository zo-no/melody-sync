import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

import {
  CHAT_PORT,
  VOICE_CONFIG_FILE,
  VOICE_DIR,
} from './config.mjs';

export const DEFAULT_STORAGE_DIR = VOICE_DIR;
export const DEFAULT_CONFIG_PATH = VOICE_CONFIG_FILE;
export const DEFAULT_CHAT_BASE_URL = `http://127.0.0.1:${CHAT_PORT}`;
export const DEFAULT_SESSION_TOOL = 'codex';
export const DEFAULT_APP_ID = 'voice';
export const DEFAULT_APP_NAME = 'Voice';
export const DEFAULT_GROUP_NAME = 'Voice';
export const DEFAULT_SESSION_MODE = 'stable';
export const DEFAULT_CAPTURE_TIMEOUT_MS = 90 * 1000;
export const DEFAULT_STT_TIMEOUT_MS = 2 * 60 * 1000;
export const DEFAULT_TTS_TIMEOUT_MS = 2 * 60 * 1000;
export const DEFAULT_TTS_RATE = 185;
export const LEGACY_DEFAULT_SESSION_SYSTEM_PROMPT = [
  'You are replying through a local wake-word voice connector powered by RemoteLab.',
  'For each assistant turn, output exactly the text that should be spoken aloud through the speaker.',
  'Keep replies concise, natural, and conversational.',
  'Prefer short sentences that sound good when spoken.',
  'Match the user\'s language unless they ask you to switch.',
  'Avoid markdown tables, code fences, bullet-heavy formatting, and raw URLs unless the user explicitly asks for them.',
  'If you need to mention structured information, say it in speech-first language.',
  'Do not mention hidden connector, session, or run internals unless the user explicitly asks.',
].join('\n');
export const DEFAULT_SESSION_SYSTEM_PROMPT = [
  'You are interacting through a local wake-word voice connector on the user\'s own machine.',
  'Keep connector-specific overrides minimal and only describe constraints not already owned by MelodySync backend prompt logic.',
].join('\n');

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeSystemPrompt(value) {
  const normalized = trimString(value);
  if (
    !normalized
    || normalized === DEFAULT_SESSION_SYSTEM_PROMPT
    || normalized === LEGACY_DEFAULT_SESSION_SYSTEM_PROMPT
  ) {
    return '';
  }
  return normalized;
}

function normalizeBaseUrl(value) {
  const normalized = trimString(value || DEFAULT_CHAT_BASE_URL).replace(/\/+$/, '');
  return normalized || DEFAULT_CHAT_BASE_URL;
}

function resolveSessionFolder(value) {
  const fallback = homedir();
  const resolved = resolveHomePath(value || fallback, fallback);
  return existsSync(resolved) ? resolved : fallback;
}

export function resolveHomePath(value, fallback = '') {
  const trimmed = trimString(value || fallback);
  if (!trimmed) return '';
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveCommandTimeout({
  env = {},
  envTimeoutKey,
  timeoutMs,
  timeoutFallbackMs,
}) {
  const stageTimeout = parsePositiveInteger(timeoutMs, undefined);
  if (stageTimeout !== undefined) {
    return stageTimeout;
  }
  const envTimeout = parsePositiveInteger(trimString(env[envTimeoutKey]), undefined);
  if (envTimeout !== undefined) {
    return envTimeout;
  }
  return timeoutFallbackMs;
}

function normalizeEnvMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entryValue]) => [trimString(key), entryValue])
      .filter(([key, entryValue]) => key && entryValue !== undefined && entryValue !== null)
      .map(([key, entryValue]) => [key, String(entryValue)]),
  );
}

function normalizeCommandStage(value, defaultTimeoutMs, envTimeoutKey) {
  if (typeof value === 'string') {
    return {
      command: trimString(value),
      timeoutMs: defaultTimeoutMs,
      env: {},
    };
  }
  const normalized = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const env = normalizeEnvMap(normalized.env);
  return {
    command: trimString(normalized.command || normalized.cmd),
    timeoutMs: resolveCommandTimeout({
      env,
      envTimeoutKey,
      timeoutMs: normalized.timeoutMs,
      timeoutFallbackMs: defaultTimeoutMs,
    }),
    env,
  };
}

function normalizeWakeConfig(value) {
  const normalized = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const command = trimString(normalized.command);
  const requestedMode = trimString(normalized.mode).toLowerCase();
  const mode = requestedMode || (command ? 'command' : 'stdin');
  if (!['command', 'stdin'].includes(mode)) {
    throw new Error(`Unsupported wake mode: ${normalized.mode}`);
  }
  if (mode === 'command' && !command) {
    throw new Error('wake.command is required when wake.mode is "command"');
  }
  return {
    mode,
    command,
    keyword: trimString(normalized.keyword),
    env: normalizeEnvMap(normalized.env),
  };
}

function normalizeTtsConfig(value) {
  const normalized = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const command = trimString(normalized.command);
  const requestedMode = trimString(normalized.mode).toLowerCase();
  const defaultMode = command ? 'command' : (process.platform === 'darwin' ? 'say' : 'disabled');
  const mode = requestedMode || defaultMode;
  if (!['command', 'say', 'disabled', 'off'].includes(mode)) {
    throw new Error(`Unsupported tts.mode: ${normalized.mode}`);
  }
  if (mode === 'command' && !command) {
    throw new Error('tts.command is required when tts.mode is "command"');
  }
  return {
    enabled: normalized.enabled !== false && mode !== 'disabled' && mode !== 'off',
    mode: mode === 'off' ? 'disabled' : mode,
    command,
    voice: trimString(normalized.voice),
    rate: parsePositiveInteger(normalized.rate, DEFAULT_TTS_RATE),
    timeoutMs: parsePositiveInteger(normalized.timeoutMs, DEFAULT_TTS_TIMEOUT_MS),
    env: normalizeEnvMap(normalized.env),
  };
}

export function buildDefaultVoiceConnectorConfig() {
  return {
    managedMode: '',
    connectorId: 'voice-main',
    roomName: '',
    chatBaseUrl: DEFAULT_CHAT_BASE_URL,
    sessionFolder: '',
    sessionTool: DEFAULT_SESSION_TOOL,
    model: '',
    effort: '',
    thinking: false,
    systemPrompt: '',
    appId: DEFAULT_APP_ID,
    appName: DEFAULT_APP_NAME,
    group: DEFAULT_GROUP_NAME,
    sessionMode: DEFAULT_SESSION_MODE,
    sessionName: '',
    description: '',
    queueMode: 'queue',
    wake: {
      mode: 'stdin',
      command: '',
      keyword: '',
      env: {},
    },
    capture: {
      command: '',
      timeoutMs: DEFAULT_CAPTURE_TIMEOUT_MS,
      env: {},
    },
    stt: {
      command: '',
      timeoutMs: DEFAULT_STT_TIMEOUT_MS,
      env: {},
    },
    tts: {
      enabled: process.platform === 'darwin',
      mode: process.platform === 'darwin' ? 'say' : 'disabled',
      command: '',
      voice: '',
      rate: DEFAULT_TTS_RATE,
      timeoutMs: DEFAULT_TTS_TIMEOUT_MS,
      env: {},
    },
    errorSpeech: '',
  };
}

export function normalizeConfig(value, options = {}) {
  const normalized = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const resolvedConfigPath = resolveHomePath(options.configPath || DEFAULT_CONFIG_PATH, DEFAULT_CONFIG_PATH);
  const storageDir = resolveHomePath(normalized.storageDir || dirname(resolvedConfigPath), DEFAULT_STORAGE_DIR);
  const connectorId = trimString(normalized.connectorId || normalized.deviceId || normalized.name || 'voice-main') || 'voice-main';
  const roomName = trimString(normalized.roomName || normalized.room);
  const sessionName = trimString(normalized.sessionName);
  const description = trimString(normalized.description);
  const sessionMode = trimString(normalized.sessionMode).toLowerCase() === 'per-wake' ? 'per-wake' : DEFAULT_SESSION_MODE;
  const queueMode = trimString(normalized.queueMode).toLowerCase() === 'ignore' ? 'ignore' : 'queue';
  const hasCustomSystemPrompt = Object.prototype.hasOwnProperty.call(normalized, 'systemPrompt');
  return {
    configPath: resolvedConfigPath,
    storageDir,
    managedMode: trimString(normalized.managedMode),
    connectorId,
    roomName,
    chatBaseUrl: normalizeBaseUrl(normalized.chatBaseUrl),
    sessionFolder: resolveSessionFolder(normalized.sessionFolder),
    sessionTool: trimString(normalized.sessionTool || DEFAULT_SESSION_TOOL) || DEFAULT_SESSION_TOOL,
    model: trimString(normalized.model),
    effort: trimString(normalized.effort),
    thinking: normalized.thinking === true,
    systemPrompt: hasCustomSystemPrompt ? normalizeSystemPrompt(normalized.systemPrompt) : '',
    appId: trimString(normalized.appId || DEFAULT_APP_ID) || DEFAULT_APP_ID,
    appName: trimString(normalized.appName || DEFAULT_APP_NAME) || DEFAULT_APP_NAME,
    group: trimString(normalized.group || DEFAULT_GROUP_NAME) || DEFAULT_GROUP_NAME,
    sessionMode,
    sessionName,
    description,
    queueMode,
    wake: normalizeWakeConfig(normalized.wake),
    capture: normalizeCommandStage(
      normalized.capture,
      DEFAULT_CAPTURE_TIMEOUT_MS,
      'VOICE_CAPTURE_TIMEOUT_MS',
    ),
    stt: normalizeCommandStage(
      normalized.stt,
      DEFAULT_STT_TIMEOUT_MS,
      'VOICE_STT_TIMEOUT_MS',
    ),
    tts: normalizeTtsConfig(normalized.tts),
    errorSpeech: trimString(normalized.errorSpeech),
  };
}

export function toPersistedVoiceConnectorConfig(value, options = {}) {
  const normalized = normalizeConfig(value, options);
  return {
    managedMode: normalized.managedMode,
    connectorId: normalized.connectorId,
    roomName: normalized.roomName,
    chatBaseUrl: normalized.chatBaseUrl,
    sessionFolder: normalized.sessionFolder,
    sessionTool: normalized.sessionTool,
    model: normalized.model,
    effort: normalized.effort,
    thinking: normalized.thinking,
    systemPrompt: normalized.systemPrompt,
    appId: normalized.appId,
    appName: normalized.appName,
    group: normalized.group,
    sessionMode: normalized.sessionMode,
    sessionName: normalized.sessionName,
    description: normalized.description,
    queueMode: normalized.queueMode,
    wake: normalized.wake,
    capture: normalized.capture,
    stt: normalized.stt,
    tts: normalized.tts,
    errorSpeech: normalized.errorSpeech,
  };
}

export function mergeVoiceConnectorConfig(currentValue = {}, patchValue = {}, options = {}) {
  const current = currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)
    ? currentValue
    : {};
  const patch = patchValue && typeof patchValue === 'object' && !Array.isArray(patchValue)
    ? patchValue
    : {};
  return toPersistedVoiceConnectorConfig({
    ...buildDefaultVoiceConnectorConfig(),
    ...current,
    ...patch,
    wake: {
      ...(current.wake || {}),
      ...(patch.wake || {}),
    },
    capture: {
      ...(current.capture || {}),
      ...(patch.capture || {}),
    },
    stt: {
      ...(current.stt || {}),
      ...(patch.stt || {}),
    },
    tts: {
      ...(current.tts || {}),
      ...(patch.tts || {}),
    },
  }, options);
}

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  const resolvedPath = resolveHomePath(configPath, DEFAULT_CONFIG_PATH);
  let raw = '';
  try {
    raw = await readFile(resolvedPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Voice connector config not found at ${resolvedPath}`);
    }
    throw error;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${resolvedPath}: ${error?.message || error}`);
  }
  return normalizeConfig(parsed, { configPath: resolvedPath });
}
