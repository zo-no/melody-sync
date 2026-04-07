import { access, appendFile, constants as fsConstants, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

import { VOICE_LOGS_DIR } from '../lib/config.mjs';
import { buildToolProcessEnv } from '../lib/user-shell-env.mjs';
import { isXfyunAvailable, synthesizeSpeechWithXfyun } from './xfyun-completion-tts.mjs';

const SAY_COMMAND = '/usr/bin/say';
const AFPLAY_COMMAND = '/usr/bin/afplay';
const DEFAULT_COMPLETION_BEEP = '/System/Library/Sounds/Ping.aiff';
const DEFAULT_COMPLETION_SPEECH = '任务需要你处理。';
const DEFAULT_COMPLETION_VOICE = 'Sandy (中文（中国大陆）)';
const DEFAULT_COMPLETION_RATE = 155;
const DEFAULT_COMPLETION_TTS_PROVIDER = 'auto';
const DEFAULT_XFYUN_VOICE = 'x4_xiaoyan';
const DEFAULT_XFYUN_SPEED = 50;
const DEFAULT_XFYUN_VOLUME = 100;
const DEFAULT_XFYUN_PITCH = 50;
const DEFAULT_TTS_FALLBACK_TO_SAY = true;
const DEFAULT_AFP_PLAY_VOLUME = 2;
const DEFAULT_AFP_PLAY_TIMEOUT_MS = 20000;

let speechPlaybackQueue = Promise.resolve();
const COMPLETION_SOUND_LOG = join(
  VOICE_LOGS_DIR,
  'host-completion-voice.log',
);

async function appendCompletionSoundLog(message) {
  try {
    await mkdir(dirname(COMPLETION_SOUND_LOG), { recursive: true });
    await appendFile(COMPLETION_SOUND_LOG, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {}
}

function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = (options.spawnImpl || spawn)(command, args, {
      env: buildToolProcessEnv(),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let settled = false;
    let timeoutHandle = null;

    const settle = (error) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (error) {
        reject(error);
        return;
      }
      resolve({ command, stderr: stderr.trim() });
    };

    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        child.kill('SIGTERM');
        settle(new Error(`${command} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    child.on('error', (error) => {
      settle(error);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        settle(new Error(`${command} failed (${code}${signal ? `/${signal}` : ''}): ${stderr.trim() || 'unknown error'}`));
        return;
      }
      settle(null);
    });
  });
}

function parseBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'y'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'n'].includes(normalized)) return false;
  }
  return fallback;
}

function mapVoiceToXfyun(voice) {
  const normalized = String(voice || '').trim().toLowerCase();
  if (!normalized) return DEFAULT_XFYUN_VOICE;
  if (normalized.includes('sandy') || normalized.includes('shelley') || normalized.includes('sherly') || normalized.includes('sherry')) return 'x4_xiaoyan';
  if (normalized.includes('eddie') || normalized.includes('edie')) return 'aisjiuxu';
  return normalized;
}

function mapSayRateToXfyunSpeed(rate) {
  const mapped = Math.round((Math.max(0, Math.min(300, Number(rate || DEFAULT_COMPLETION_RATE))) - 100) / 1.5);
  if (!Number.isFinite(mapped) || mapped <= 0) return DEFAULT_XFYUN_SPEED;
  return Math.min(100, Math.max(0, mapped));
}

function estimateAfplayTimeoutMs(speechText) {
  const text = String(speechText || '').trim();
  if (!text) return DEFAULT_AFP_PLAY_TIMEOUT_MS;
  const estimatedMs = Math.max(
    DEFAULT_AFP_PLAY_TIMEOUT_MS,
    8000 + (text.length * 220),
  );
  return Math.min(90000, estimatedMs);
}

async function playXfyunSpeech({
  speechText,
  voice,
  rate,
  timeoutMs,
}) {
  const synthesis = await synthesizeSpeechWithXfyun({
    text: speechText,
    voice: String(process.env.XFYUN_VOICE || mapVoiceToXfyun(voice)),
    speed: Number.isFinite(Number(process.env.XFYUN_SPEED))
      ? Number(process.env.XFYUN_SPEED)
      : mapSayRateToXfyunSpeed(rate),
    volume: Number.isFinite(Number(process.env.XFYUN_VOLUME))
      ? Number(process.env.XFYUN_VOLUME)
      : DEFAULT_XFYUN_VOLUME,
    pitch: Number.isFinite(Number(process.env.XFYUN_PITCH))
      ? Number(process.env.XFYUN_PITCH)
      : DEFAULT_XFYUN_PITCH,
    timeoutMs,
  });
  const afplayVolume = Number.isFinite(Number(process.env.COMPLETION_AFP_PLAY_VOLUME))
    ? Number(process.env.COMPLETION_AFP_PLAY_VOLUME)
    : DEFAULT_AFP_PLAY_VOLUME;
  const afplayArgs = Number.isFinite(afplayVolume) && afplayVolume > 0
    ? ['-v', String(afplayVolume), synthesis.soundPath]
    : [synthesis.soundPath];
  await runCommand(AFPLAY_COMMAND, afplayArgs, {
    timeoutMs: estimateAfplayTimeoutMs(speechText),
  });
  return { provider: 'xfyun', soundPath: synthesis.soundPath, bytes: synthesis.bytes };
}

export async function playHostCompletionSound(options = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('Host completion sound is only supported on macOS');
  }

  const speechCommand = String(options.speechCommand || SAY_COMMAND).trim() || SAY_COMMAND;
  const beepCommand = String(options.beepCommand || AFPLAY_COMMAND).trim() || AFPLAY_COMMAND;
  const beepPath = String(options.beepPath || DEFAULT_COMPLETION_BEEP).trim() || DEFAULT_COMPLETION_BEEP;
  const speechText = String(options.speechText || DEFAULT_COMPLETION_SPEECH).trim() || DEFAULT_COMPLETION_SPEECH;
  await access(speechCommand, fsConstants.X_OK);
  await access(beepCommand, fsConstants.X_OK);
  if (beepPath) {
    await access(beepPath, fsConstants.F_OK);
  }

  const args = [];
  const voice = typeof options.voice === 'string'
    ? options.voice.trim()
    : DEFAULT_COMPLETION_VOICE;
  if (voice) {
    args.push('-v', voice);
  }
  const rate = Number.isFinite(options.rate)
    ? Math.round(options.rate)
    : DEFAULT_COMPLETION_RATE;
  if (Number.isFinite(rate) && rate > 0) {
    args.push('-r', String(rate));
  }
  args.push(speechText);

  const preference = String(
    options.completionTtsProvider || process.env.COMPLETION_TTS_PROVIDER || DEFAULT_COMPLETION_TTS_PROVIDER,
  ).trim().toLowerCase();
  const fallbackToSay = parseBoolean(
    options.fallbackToSay ?? process.env.COMPLETION_TTS_FALLBACK_TO_SAY,
    DEFAULT_TTS_FALLBACK_TO_SAY,
  );
  const useXfyun = preference === 'xfyun'
    ? true
    : preference === 'say'
      ? false
      : isXfyunAvailable();

  let finalMode = 'say';
  let finalSoundPath = '';

  const playback = speechPlaybackQueue.catch(() => {}).then(async () => {
      await appendCompletionSoundLog(`[start] provider="${useXfyun ? 'xfyun' : 'say'}" voice="${voice}" text="${speechText}"`);
    try {
      if (beepPath) {
        try {
          await runCommand(beepCommand, [beepPath], { timeoutMs: 3000 });
        } catch (error) {
          await appendCompletionSoundLog(`[warn] provider="beep" voice="${voice}" text="${speechText}" message="${error?.message || error}"`);
        }
      }

      if (useXfyun) {
        try {
          const xfyun = await playXfyunSpeech({
            speechText,
            voice,
            rate,
            timeoutMs: options.timeoutMs,
          });
          finalMode = 'xfyun';
          finalSoundPath = xfyun.soundPath || '';
          await appendCompletionSoundLog(`[ok] provider="xfyun" voice="${voice}" text="${speechText}" path="${xfyun.soundPath}" bytes="${xfyun.bytes}"`);
          return;
        } catch (error) {
          await appendCompletionSoundLog(`[warn] provider="xfyun" voice="${voice}" text="${speechText}" message="${error?.message || error}" fallback="${fallbackToSay}"`);
          if (!fallbackToSay) throw error;
        }
      }

      finalMode = 'say';
      await runCommand(speechCommand, args, {
        spawnImpl: options.spawnImpl,
        timeoutMs: options.timeoutMs,
      });
      await appendCompletionSoundLog(`[ok] provider="say" voice="${voice}" text="${speechText}"`);
    } catch (error) {
      await appendCompletionSoundLog(`[error] provider="${useXfyun ? 'xfyun' : 'say'}" voice="${voice}" text="${speechText}" message="${error?.message || error}"`);
      throw error;
    }
  });

  speechPlaybackQueue = playback;
  await playback;

  return {
    speechCommand,
    speechText,
    provider: finalMode,
    soundPath: finalSoundPath,
  };
}
