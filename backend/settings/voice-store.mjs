import { readFile } from 'fs/promises';

import { buildMelodySyncPaths } from '../../lib/config.mjs';
import {
  buildDefaultVoiceConnectorConfig,
  mergeVoiceConnectorConfig,
  normalizeConfig as normalizeVoiceConnectorConfig,
} from '../../lib/voice-connector-config.mjs';
import {
  buildManagedVoiceConfigPatch,
  buildVoiceModeHints,
  DEFAULT_WAKE_PHRASE,
  inferSimpleVoiceMode,
  inferWakePhrase,
  VOICE_SIMPLE_MODE_OPTIONS,
} from '../../lib/voice-connector-presets.mjs';
import { ensureDir, readJson, writeJsonAtomic } from '../fs-utils.mjs';
import { readGeneralSettings } from './general-store.mjs';

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringField(value) {
  return trimString(value);
}

function normalizeBooleanField(value) {
  return value === true;
}

function normalizePositiveIntegerField(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeEnvMap(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entryValue]) => [trimString(key), entryValue])
      .filter(([key, entryValue]) => key && entryValue !== undefined && entryValue !== null)
      .map(([key, entryValue]) => [key, String(entryValue)]),
  );
}

async function readVoiceConfigFile(path) {
  return (await readJson(path, null)) || null;
}

async function ensureVoiceConfigFile(path) {
  const current = await readVoiceConfigFile(path);
  if (current) return current;
  const next = buildDefaultVoiceConnectorConfig();
  await writeJsonAtomic(path, next);
  return next;
}

async function readVoiceStatus(paths) {
  let pid = '';
  try {
    pid = trimString(await readFile(paths.voiceConnectorPidFile, 'utf8'));
    if (pid) {
      process.kill(Number(pid), 0);
      return {
        running: true,
        pid,
        label: `运行中（pid ${pid}）`,
      };
    }
  } catch {
    // Ignore missing pid files and stale processes.
  }
  return {
    running: false,
    pid: '',
    label: '未运行',
  };
}

async function resolveVoiceSettingsContext() {
  const general = await readGeneralSettings();
  const paths = buildMelodySyncPaths({
    brainRoot: general.brainRoot || general.appRoot,
    runtimeRoot: general.runtimeRoot,
    machineConfigRoot: general.machineOverlayRoot,
    agentsFile: general.agentsPath,
  });
  await ensureDir(paths.voiceDir);
  await ensureDir(paths.voiceLogsDir);
  const storedConfig = await ensureVoiceConfigFile(paths.voiceConfigFile);
  const normalizedConfig = normalizeVoiceConnectorConfig(storedConfig, { configPath: paths.voiceConfigFile });
  return {
    general,
    paths,
    storedConfig,
    normalizedConfig,
  };
}

async function buildVoiceSettingsPayload({ general, paths, normalizedConfig }) {
  const status = await readVoiceStatus(paths);
  const commandPath = paths.voiceConfigFile;
  const simpleMode = inferSimpleVoiceMode(normalizedConfig);
  const wakePhrase = inferWakePhrase(normalizedConfig);
  return {
    appRoot: general.appRoot,
    voiceRoot: paths.voiceDir,
    paths: {
      voiceRoot: paths.voiceDir,
      configFile: paths.voiceConfigFile,
      logsDir: paths.voiceLogsDir,
      eventsLogFile: paths.voiceEventsLogFile,
      pidFile: paths.voiceConnectorPidFile,
      runtimeLogFile: paths.voiceRuntimeLogFile,
      launcherFile: paths.voiceLauncherFile,
    },
    config: normalizedConfig,
    simpleConfig: {
      mode: simpleMode,
      wakePhrase: wakePhrase || DEFAULT_WAKE_PHRASE,
      ttsEnabled: normalizedConfig.tts?.enabled !== false,
    },
    status,
    commands: {
      start: './scripts/voice-connector-instance.sh start',
      stop: './scripts/voice-connector-instance.sh stop',
      status: './scripts/voice-connector-instance.sh status',
      testText: `npm run voice:connect -- --config "${commandPath}" --text "你好" --no-speak`,
    },
    options: {
      simpleModes: VOICE_SIMPLE_MODE_OPTIONS,
    },
    hints: buildVoiceModeHints(),
  };
}

function normalizeVoiceSettingsPatch(payload = {}, currentConfig = {}) {
  const patch = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const current = currentConfig && typeof currentConfig === 'object' && !Array.isArray(currentConfig) ? currentConfig : {};
  const managedSimplePatch = (
    Object.prototype.hasOwnProperty.call(patch, 'mode')
    || Object.prototype.hasOwnProperty.call(patch, 'wakePhrase')
    || Object.prototype.hasOwnProperty.call(patch, 'ttsEnabled')
  )
    ? buildManagedVoiceConfigPatch({
      mode: normalizeStringField(patch.mode) || inferSimpleVoiceMode(current),
      wakePhrase: normalizeStringField(patch.wakePhrase) || inferWakePhrase(current),
      ttsEnabled: Object.prototype.hasOwnProperty.call(patch, 'ttsEnabled')
        ? normalizeBooleanField(patch.ttsEnabled)
        : current.tts?.enabled !== false,
    })
    : {};

  return mergeVoiceConnectorConfig(current, {
    ...(Object.prototype.hasOwnProperty.call(patch, 'connectorId') ? { connectorId: normalizeStringField(patch.connectorId) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'roomName') ? { roomName: normalizeStringField(patch.roomName) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'chatBaseUrl') ? { chatBaseUrl: normalizeStringField(patch.chatBaseUrl) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'sessionFolder') ? { sessionFolder: normalizeStringField(patch.sessionFolder) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'sessionTool') ? { sessionTool: normalizeStringField(patch.sessionTool) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'model') ? { model: normalizeStringField(patch.model) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'effort') ? { effort: normalizeStringField(patch.effort) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'thinking') ? { thinking: normalizeBooleanField(patch.thinking) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'systemPrompt') ? { systemPrompt: patch.systemPrompt == null ? '' : String(patch.systemPrompt) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'appName') ? { appName: normalizeStringField(patch.appName) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'group') ? { group: normalizeStringField(patch.group) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'sessionMode') ? { sessionMode: normalizeStringField(patch.sessionMode) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'sessionName') ? { sessionName: normalizeStringField(patch.sessionName) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'description') ? { description: normalizeStringField(patch.description) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'queueMode') ? { queueMode: normalizeStringField(patch.queueMode) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'errorSpeech') ? { errorSpeech: normalizeStringField(patch.errorSpeech) } : {}),
    ...(patch.wake && typeof patch.wake === 'object' ? {
      wake: {
        ...(current.wake || {}),
        mode: Object.prototype.hasOwnProperty.call(patch.wake, 'mode')
          ? normalizeStringField(patch.wake.mode)
          : current.wake?.mode,
        keyword: Object.prototype.hasOwnProperty.call(patch.wake, 'keyword')
          ? normalizeStringField(patch.wake.keyword)
          : current.wake?.keyword,
        command: Object.prototype.hasOwnProperty.call(patch.wake, 'command')
          ? normalizeStringField(patch.wake.command)
          : current.wake?.command,
        env: Object.prototype.hasOwnProperty.call(patch.wake, 'env')
          ? normalizeEnvMap(patch.wake.env)
          : (current.wake?.env || {}),
      },
    } : {}),
    ...(patch.capture && typeof patch.capture === 'object' ? {
      capture: {
        ...(current.capture || {}),
        command: Object.prototype.hasOwnProperty.call(patch.capture, 'command')
          ? normalizeStringField(patch.capture.command)
          : current.capture?.command,
        timeoutMs: Object.prototype.hasOwnProperty.call(patch.capture, 'timeoutMs')
          ? normalizePositiveIntegerField(patch.capture.timeoutMs, current.capture?.timeoutMs)
          : current.capture?.timeoutMs,
        env: Object.prototype.hasOwnProperty.call(patch.capture, 'env')
          ? normalizeEnvMap(patch.capture.env)
          : (current.capture?.env || {}),
      },
    } : {}),
    ...(patch.stt && typeof patch.stt === 'object' ? {
      stt: {
        ...(current.stt || {}),
        command: Object.prototype.hasOwnProperty.call(patch.stt, 'command')
          ? normalizeStringField(patch.stt.command)
          : current.stt?.command,
        timeoutMs: Object.prototype.hasOwnProperty.call(patch.stt, 'timeoutMs')
          ? normalizePositiveIntegerField(patch.stt.timeoutMs, current.stt?.timeoutMs)
          : current.stt?.timeoutMs,
        env: Object.prototype.hasOwnProperty.call(patch.stt, 'env')
          ? normalizeEnvMap(patch.stt.env)
          : (current.stt?.env || {}),
      },
    } : {}),
    ...(patch.tts && typeof patch.tts === 'object' ? {
      tts: {
        ...(current.tts || {}),
        enabled: Object.prototype.hasOwnProperty.call(patch.tts, 'enabled')
          ? normalizeBooleanField(patch.tts.enabled)
          : current.tts?.enabled,
        mode: Object.prototype.hasOwnProperty.call(patch.tts, 'mode')
          ? normalizeStringField(patch.tts.mode)
          : current.tts?.mode,
        voice: Object.prototype.hasOwnProperty.call(patch.tts, 'voice')
          ? normalizeStringField(patch.tts.voice)
          : current.tts?.voice,
        rate: Object.prototype.hasOwnProperty.call(patch.tts, 'rate')
          ? normalizePositiveIntegerField(patch.tts.rate, current.tts?.rate)
          : current.tts?.rate,
        command: Object.prototype.hasOwnProperty.call(patch.tts, 'command')
          ? normalizeStringField(patch.tts.command)
          : current.tts?.command,
        timeoutMs: Object.prototype.hasOwnProperty.call(patch.tts, 'timeoutMs')
          ? normalizePositiveIntegerField(patch.tts.timeoutMs, current.tts?.timeoutMs)
          : current.tts?.timeoutMs,
        env: Object.prototype.hasOwnProperty.call(patch.tts, 'env')
          ? normalizeEnvMap(patch.tts.env)
          : (current.tts?.env || {}),
      },
    } : {}),
    ...managedSimplePatch,
  }, {
    configPath: current.configPath,
  });
}

export async function ensureVoiceSettingsRuntimeFiles() {
  const context = await resolveVoiceSettingsContext();
  return await buildVoiceSettingsPayload(context);
}

export async function readVoiceSettings() {
  const context = await resolveVoiceSettingsContext();
  return await buildVoiceSettingsPayload(context);
}

export async function persistVoiceSettings(payload = {}) {
  const context = await resolveVoiceSettingsContext();
  const next = normalizeVoiceSettingsPatch(payload, context.storedConfig);
  await writeJsonAtomic(context.paths.voiceConfigFile, next);
  return readVoiceSettings();
}
