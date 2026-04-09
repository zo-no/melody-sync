import { existsSync } from 'fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { VOICE_DIR } from '../lib/config.mjs';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';

const COMPLETION_NOTICE_TTL_MS = 6 * 60 * 60 * 1000;
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const COMPLETION_VOICE_DIR = join(VOICE_DIR, 'host-completion-voice');
const QUEUE_DIR = join(COMPLETION_VOICE_DIR, 'queue');
const WORKER_PID_FILE = join(COMPLETION_VOICE_DIR, 'host-completion-voice-worker.pid');
const COMPLETION_NOTICE_INDEX_FILE = join(COMPLETION_VOICE_DIR, 'completion-notice-index.json');
const WORKER_SCRIPT_CANDIDATES = Object.freeze([
  join(REPO_ROOT, 'scripts', 'voice', 'host-completion-voice-worker.mjs'),
  join(REPO_ROOT, 'scripts', 'host-completion-voice-worker.mjs'),
]);
let ensureWorkerPromise = null;
const completionNoticeInMemoryCache = new Map();
const completionNoticeEnqueueInflight = new Map();

export function resolveHostCompletionVoiceWorkerScript() {
  for (const candidate of WORKER_SCRIPT_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return WORKER_SCRIPT_CANDIDATES[0];
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureQueueDir() {
  await mkdir(QUEUE_DIR, { recursive: true });
}

async function readWorkerPid() {
  try {
    const raw = await readFile(WORKER_PID_FILE, 'utf8');
    const pid = Number.parseInt(String(raw || '').trim(), 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

function normalizeCompletionNoticeKey(value) {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : '';
}

async function readCompletionNoticeIndex() {
  try {
    const raw = await readFile(COMPLETION_NOTICE_INDEX_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

async function writeCompletionNoticeIndex(state = {}) {
  try {
    await mkdir(dirname(COMPLETION_NOTICE_INDEX_FILE), { recursive: true });
    await writeFile(COMPLETION_NOTICE_INDEX_FILE, JSON.stringify(state));
  } catch {}
}

function pruneExpiredCompletionNoticeIndex(state = {}, now = Date.now()) {
  const next = { ...state };
  for (const [key, value] of Object.entries(next)) {
    if (!value?.expiresAt || Number.isNaN(Number(value.expiresAt)) || Number(value.expiresAt) <= now) {
      delete next[key];
      completionNoticeInMemoryCache.delete(key);
    } else if (!completionNoticeInMemoryCache.has(key)) {
      completionNoticeInMemoryCache.set(key, Number(value.expiresAt));
    }
  }
  return next;
}

async function markCompletionNoticeSeen(key) {
  const normalized = normalizeCompletionNoticeKey(key);
  if (!normalized) return;
  const now = Date.now();
  const expiresAt = now + COMPLETION_NOTICE_TTL_MS;
  const raw = await readCompletionNoticeIndex();
  const state = pruneExpiredCompletionNoticeIndex(raw, now);
  state[normalized] = { expiresAt };
  completionNoticeInMemoryCache.set(normalized, expiresAt);
  await writeCompletionNoticeIndex(state);
}

async function withCompletionNoticeEnqueueLock(key, task) {
  const normalized = normalizeCompletionNoticeKey(key);
  if (!normalized || typeof task !== 'function') {
    return task();
  }
  const previous = completionNoticeEnqueueInflight.get(normalized) || Promise.resolve();
  const next = previous
    .then(async () => task())
    .finally(() => {
      if (completionNoticeEnqueueInflight.get(normalized) === next) {
        completionNoticeEnqueueInflight.delete(normalized);
      }
    });
  completionNoticeEnqueueInflight.set(normalized, next);
  try {
    return await next;
  } catch (error) {
    throw error;
  }
}

async function shouldSkipCompletionNotice(key) {
  const normalized = normalizeCompletionNoticeKey(key);
  if (!normalized) return false;
  const now = Date.now();
  const seenUntil = completionNoticeInMemoryCache.get(normalized);
  if (Number.isFinite(seenUntil) && seenUntil > now) return true;
  if (Number.isFinite(seenUntil) && seenUntil <= now) {
    completionNoticeInMemoryCache.delete(normalized);
  }

  const state = pruneExpiredCompletionNoticeIndex(await readCompletionNoticeIndex(), now);
  const persisted = state[normalized]?.expiresAt;
  if (Number.isFinite(Number(persisted)) && Number(persisted) > now) {
    completionNoticeInMemoryCache.set(normalized, Number(persisted));
    return true;
  }
  return false;
}

async function ensureWorker() {
  if (ensureWorkerPromise) {
    await ensureWorkerPromise;
    return;
  }
  ensureWorkerPromise = (async () => {
    await ensureQueueDir();
    const pid = await readWorkerPid();
    if (isPidAlive(pid)) return;
    const child = spawn(process.execPath, [resolveHostCompletionVoiceWorkerScript()], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref?.();
  })();
  try {
    await ensureWorkerPromise;
  } finally {
    ensureWorkerPromise = null;
  }
}

export async function enqueueHostCompletionSpeech(payload = {}) {
  const completionNoticeKey = normalizeCompletionNoticeKey(payload.completionNoticeKey);
  return withCompletionNoticeEnqueueLock(completionNoticeKey, async () => {
    await ensureQueueDir();
    if (completionNoticeKey && await shouldSkipCompletionNotice(completionNoticeKey)) {
      return null;
    }

    const jobId = `${Date.now()}-${randomBytes(4).toString('hex')}`;
    const jobPath = join(QUEUE_DIR, `${jobId}.json`);
    const jobPayload = {
      speechText: String(payload.speechText || '').trim(),
    };
    if (completionNoticeKey) {
      jobPayload.completionNoticeKey = completionNoticeKey;
    }
    if (payload.runId) {
      jobPayload.runId = String(payload.runId);
    }
    if (payload.run) {
      jobPayload.run = payload.run;
    }
    if (typeof payload.completionTtsProvider === 'string') {
      const normalizedProvider = payload.completionTtsProvider.trim();
      if (normalizedProvider) {
        jobPayload.completionTtsProvider = normalizedProvider;
      }
    }
    if (typeof payload.fallbackToSay === 'boolean') {
      jobPayload.fallbackToSay = payload.fallbackToSay;
    }
    if (Number.isFinite(payload.rate)) {
      jobPayload.rate = payload.rate;
    }
    const voice = String(payload.voice || '').trim();
    if (voice) {
      jobPayload.voice = voice;
    }
    await writeFile(jobPath, JSON.stringify(jobPayload, null, 2));
    if (completionNoticeKey) {
      await markCompletionNoticeSeen(completionNoticeKey);
    }
    await ensureWorker();
    return jobPath;
  });
}

export async function listQueuedSpeechJobs() {
  await ensureQueueDir();
  const entries = await readdir(QUEUE_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => join(QUEUE_DIR, entry.name))
    .sort();
}

export async function readQueuedSpeechJob(jobPath) {
  const raw = await readFile(jobPath, 'utf8');
  return JSON.parse(raw);
}

export async function deleteQueuedSpeechJob(jobPath) {
  await rm(jobPath, { force: true });
}

export async function writeSpeechWorkerPid(pid) {
  await mkdir(dirname(WORKER_PID_FILE), { recursive: true });
  await writeFile(WORKER_PID_FILE, String(pid), 'utf8');
}

export async function clearSpeechWorkerPid() {
  await rm(WORKER_PID_FILE, { force: true });
}
