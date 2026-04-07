import { createHmac } from 'crypto';
import { randomBytes } from 'crypto';
import { writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { WebSocket } from 'ws';

const DEFAULT_XFYUN_HOST = 'tts-api.xfyun.cn';
const DEFAULT_XFYUN_PATH = '/v2/tts';
const DEFAULT_XFYUN_REQUEST_LINE = `GET ${DEFAULT_XFYUN_PATH} HTTP/1.1`;
const DEFAULT_XFYUN_VOICE = 'x4_xiaoyan';
const DEFAULT_XFYUN_SPEED = 50;
const DEFAULT_XFYUN_VOLUME = 50;
const DEFAULT_XFYUN_PITCH = 50;
const XFYUN_TIMEOUT_MS = 30000;
const XFYUN_TEXT_BYTES_LIMIT = 8000;

function normalizeText(text) {
  return String(text || '').trim();
}

function normalizeUrlPart(value) {
  return String(value || '').trim();
}

function normalizeVoice(voice) {
  const normalized = String(voice || '').trim().toLowerCase();
  if (!normalized) return DEFAULT_XFYUN_VOICE;
  if (
    normalized.includes('sandy') ||
    normalized.includes('shelley') ||
    normalized.includes('shely') ||
    normalized.includes('sherry')
  ) return 'x4_xiaoyan';
  if (normalized.includes('eddie') || normalized.includes('edie')) return 'aisjiuxu';
  return normalized;
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  const parsed = Math.round(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function createTempPath() {
  const name = `${Date.now()}-${randomBytes(4).toString('hex')}.mp3`;
  return join(tmpdir(), `melodysync-tts-${name}`);
}

function wsMessageToObject(message) {
  try {
    if (typeof message === 'string') {
      return JSON.parse(message);
    }
    if (message instanceof ArrayBuffer || Buffer.isBuffer(message)) {
      return JSON.parse(Buffer.from(message).toString('utf8'));
    }
    return null;
  } catch {
    return null;
  }
}

export function buildXfyunAuthUrl({
  appId,
  apiKey,
  apiSecret,
  host = DEFAULT_XFYUN_HOST,
  path = DEFAULT_XFYUN_PATH,
}) {
  const resolvedAppId = normalizeUrlPart(appId);
  const resolvedApiKey = normalizeUrlPart(apiKey);
  const resolvedApiSecret = normalizeUrlPart(apiSecret);
  const resolvedHost = normalizeUrlPart(host);
  if (!resolvedAppId || !resolvedApiKey || !resolvedApiSecret) {
    throw new Error('XFYun credentials are required');
  }
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${resolvedHost}\ndate: ${date}\n${DEFAULT_XFYUN_REQUEST_LINE}`;
  const signature = createHmac('sha256', resolvedApiSecret).update(signatureOrigin).digest('base64');
  const authorizationOrigin = `api_key="${resolvedApiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin, 'utf8').toString('base64');

  const authUrl = new URL(`wss://${resolvedHost}${path}`);
  authUrl.searchParams.set('authorization', authorization);
  authUrl.searchParams.set('host', resolvedHost);
  authUrl.searchParams.set('date', date);

  return { authUrl: authUrl.toString(), appId: resolvedAppId };
}

function buildRequestPayload({
  appId,
  voice = DEFAULT_XFYUN_VOICE,
  speed = DEFAULT_XFYUN_SPEED,
  volume = DEFAULT_XFYUN_VOLUME,
  pitch = DEFAULT_XFYUN_PITCH,
  text,
}) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) throw new Error('No text for XFYun TTS');
  if (Buffer.byteLength(normalizedText, 'utf8') > XFYUN_TEXT_BYTES_LIMIT) {
    throw new Error('XFYun TTS text exceeds maximum length');
  }

  return {
    common: { app_id: appId },
    business: {
      aue: 'lame',
      sfl: 1,
      auf: 'audio/L16;rate=16000',
      vcn: normalizeVoice(voice),
      speed: clamp(speed, 0, 100, DEFAULT_XFYUN_SPEED),
      volume: clamp(volume, 0, 100, DEFAULT_XFYUN_VOLUME),
      pitch: clamp(pitch, 0, 100, DEFAULT_XFYUN_PITCH),
      tte: 'UTF8',
    },
    data: {
      status: 2,
      text: Buffer.from(normalizedText, 'utf8').toString('base64'),
    },
  };
}

export async function synthesizeSpeechWithXfyun({
  text,
  voice,
  speed = DEFAULT_XFYUN_SPEED,
  appId = process.env.XFYUN_APP_ID,
  apiKey = process.env.XFYUN_API_KEY,
  apiSecret = process.env.XFYUN_API_SECRET,
  host = DEFAULT_XFYUN_HOST,
  volume = DEFAULT_XFYUN_VOLUME,
  pitch = DEFAULT_XFYUN_PITCH,
  socketFactory = WebSocket,
  timeoutMs = XFYUN_TIMEOUT_MS,
}) {
  const { authUrl, appId: resolvedAppId } = buildXfyunAuthUrl({
    appId,
    apiKey,
    apiSecret,
    host,
  });

  const payload = buildRequestPayload({
    appId: resolvedAppId,
    voice,
    speed,
    volume,
    pitch,
    text,
  });

  const outputPath = createTempPath();

  return new Promise((resolve, reject) => {
    const socket = new socketFactory(authUrl, { rejectUnauthorized: true });
    const chunks = [];
    let done = false;
    let endedWithResult = false;
    let timeoutHandle;

    const cleanup = async () => {
      try {
        await rm(outputPath, { force: true });
      } catch {}
    };

    const onError = async (error) => {
      if (done) return;
      done = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      try {
        socket.close();
      } catch {}
      await cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const onSuccess = async () => {
      if (done) return;
      done = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      try {
        socket.close(1000, 'done');
      } catch {}
      if (!endedWithResult || chunks.length === 0) {
        reject(new Error('XFYun returned no audio data'));
        return;
      }
      try {
        await writeFile(outputPath, Buffer.concat(chunks));
      } catch (error) {
        await cleanup();
        reject(error);
        return;
      }
      resolve({ soundPath: outputPath, bytes: chunks.reduce((sum, chunk) => sum + chunk.length, 0), chunks: chunks.length });
    };

    timeoutHandle = setTimeout(() => onError(new Error(`XFYun WebSocket timed out after ${timeoutMs}ms`)), timeoutMs);

    socket.on('open', () => {
      try {
        socket.send(JSON.stringify(payload));
      } catch (error) {
        onError(error);
      }
    });

    socket.on('message', async (message) => {
      if (done) return;
      const frame = wsMessageToObject(message);
      if (!frame) return;
      const code = Number(frame.code ?? 0);
      if (Number.isFinite(code) && code !== 0) {
        await onError(new Error(`XFYun error ${code}: ${frame.message || 'unknown error'}`));
        return;
      }
      const data = frame.data || {};
      const status = Number(data.status);
      const audioText = typeof data.audio === 'string' ? data.audio.trim() : '';
      if (audioText) {
        chunks.push(Buffer.from(audioText, 'base64'));
      }
      if (status === 2) {
        endedWithResult = true;
        await onSuccess();
      }
    });

    socket.on('close', async () => {
      if (done) return;
      if (endedWithResult) return;
      await onError(new Error('XFYun WebSocket closed before synthesis completed'));
    });

    socket.on('error', async (error) => {
      await onError(error);
    });
  });
}

export function isXfyunAvailable({
  appId = process.env.XFYUN_APP_ID,
  apiKey = process.env.XFYUN_API_KEY,
  apiSecret = process.env.XFYUN_API_SECRET,
} = {}) {
  return Boolean(normalizeUrlPart(appId) && normalizeUrlPart(apiKey) && normalizeUrlPart(apiSecret));
}
