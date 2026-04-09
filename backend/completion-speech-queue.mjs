import { existsSync } from 'fs';
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { basename, dirname, join } from 'path';
import { VOICE_DIR } from '../lib/config.mjs';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { playHostCompletionSound } from './completion-sound.mjs';

const COMPLETION_NOTICE_TTL_MS = 6 * 60 * 60 * 1000;
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const COMPLETION_VOICE_DIR = join(VOICE_DIR, 'host-completion-voice');
const QUEUE_DIR = join(COMPLETION_VOICE_DIR, 'queue');
const FAILED_DIR = join(COMPLETION_VOICE_DIR, 'failed');
const WORKER_LOG_FILE = join(COMPLETION_VOICE_DIR, 'logs', 'worker.log');
const WORKER_PID_FILE = join(COMPLETION_VOICE_DIR, 'host-completion-voice-worker.pid');
const COMPLETION_NOTICE_INDEX_FILE = join(COMPLETION_VOICE_DIR, 'completion-notice-index.json');
const WORKER_SCRIPT_CANDIDATES = Object.freeze([
  join(REPO_ROOT, 'scripts', 'voice', 'host-completion-voice-worker.mjs'),
  join(REPO_ROOT, 'scripts', 'host-completion-voice-worker.mjs'),
]);
const WORKER_READY_TIMEOUT_MS = 5000;
const WORKER_READY_POLL_MS = 50;
const DRAIN_IDLE_POLL_MS = 150;
const DRAIN_IDLE_GRACE_MS = 1500;
const DEFAULT_WATCHDOG_INTERVAL_MS = 30000;
let ensureWorkerPromise = null;
let inProcessDrainPromise = null;
let watchdogTimer = null;
let watchdogTickPromise = null;
const completionNoticeInMemoryCache = new Map();
const completionNoticeMutationInflight = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function appendWorkerLog(message) {
  try {
    await mkdir(dirname(WORKER_LOG_FILE), { recursive: true });
    await appendFile(WORKER_LOG_FILE, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {}
}

export function resolveHostCompletionVoiceWorkerScript() {
  for (const candidate of WORKER_SCRIPT_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return WORKER_SCRIPT_CANDIDATES[0];
}

function normalizeJobId(value) {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : '';
}

function buildQueueJobPath(jobId) {
  return join(QUEUE_DIR, `${normalizeJobId(jobId)}.json`);
}

export function parseQueuedSpeechJobId(jobPath) {
  const filename = basename(String(jobPath || ''));
  if (!filename.endsWith('.json')) return '';
  return normalizeJobId(filename.slice(0, -5));
}

function buildDeliveredRecord(expiresAt, deliveredAt = Date.now()) {
  return {
    status: 'delivered',
    deliveredAt,
    expiresAt,
  };
}

function buildQueuedRecord(jobId, queuedAt = Date.now()) {
  return {
    status: 'queued',
    jobId: normalizeJobId(jobId),
    queuedAt,
  };
}

function normalizeCompletionNoticeRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const normalizedStatus = String(value.status || '').trim().toLowerCase();
  if (normalizedStatus === 'queued') {
    const jobId = normalizeJobId(value.jobId);
    if (!jobId) return null;
    const queuedAt = Number(value.queuedAt);
    return {
      status: 'queued',
      jobId,
      queuedAt: Number.isFinite(queuedAt) ? queuedAt : undefined,
    };
  }

  const expiresAt = Number(value.expiresAt);
  if (normalizedStatus === 'delivered' || Number.isFinite(expiresAt)) {
    if (!Number.isFinite(expiresAt)) return null;
    const deliveredAt = Number(value.deliveredAt);
    return {
      status: 'delivered',
      expiresAt,
      deliveredAt: Number.isFinite(deliveredAt) ? deliveredAt : undefined,
    };
  }

  return null;
}

function hasLiveQueuedJob(record) {
  if (record?.status !== 'queued') return false;
  const jobId = normalizeJobId(record.jobId);
  return !!jobId && existsSync(buildQueueJobPath(jobId));
}

async function findQueuedSpeechJobByCompletionNoticeKey(key) {
  const normalized = normalizeCompletionNoticeKey(key);
  if (!normalized) return null;
  const jobs = await listQueuedSpeechJobs();
  for (const jobPath of jobs) {
    try {
      const job = await readQueuedSpeechJob(jobPath);
      if (normalizeCompletionNoticeKey(job?.completionNoticeKey) === normalized) {
        return {
          jobPath,
          jobId: parseQueuedSpeechJobId(jobPath),
        };
      }
    } catch {}
  }
  return null;
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
  const next = {};
  let changed = false;

  for (const [key, value] of Object.entries(state || {})) {
    const normalizedKey = normalizeCompletionNoticeKey(key);
    const record = normalizeCompletionNoticeRecord(value);
    if (!normalizedKey || !record) {
      changed = true;
      completionNoticeInMemoryCache.delete(normalizedKey);
      continue;
    }

    if (record.status === 'queued') {
      if (!hasLiveQueuedJob(record)) {
        changed = true;
        completionNoticeInMemoryCache.delete(normalizedKey);
        continue;
      }
      next[normalizedKey] = record;
      completionNoticeInMemoryCache.set(normalizedKey, record);
      continue;
    }

    if (!Number.isFinite(record.expiresAt) || record.expiresAt <= now) {
      changed = true;
      completionNoticeInMemoryCache.delete(normalizedKey);
      continue;
    }
    next[normalizedKey] = record;
    completionNoticeInMemoryCache.set(normalizedKey, record);
  }

  return { state: next, changed };
}

async function readPrunedCompletionNoticeIndex(now = Date.now()) {
  const raw = await readCompletionNoticeIndex();
  const pruned = pruneExpiredCompletionNoticeIndex(raw, now);
  if (pruned.changed) {
    await writeCompletionNoticeIndex(pruned.state);
  }
  return pruned.state;
}

async function updateCompletionNoticeRecord(key, updater) {
  const normalized = normalizeCompletionNoticeKey(key);
  if (!normalized || typeof updater !== 'function') return null;

  const previous = completionNoticeMutationInflight.get(normalized) || Promise.resolve();
  const next = previous
    .then(async () => {
      const state = await readPrunedCompletionNoticeIndex();
      const nextRecord = await updater(state[normalized] || null, state);
      if (!nextRecord) {
        delete state[normalized];
        completionNoticeInMemoryCache.delete(normalized);
      } else {
        state[normalized] = nextRecord;
        completionNoticeInMemoryCache.set(normalized, nextRecord);
      }
      await writeCompletionNoticeIndex(state);
      return nextRecord;
    })
    .finally(() => {
      if (completionNoticeMutationInflight.get(normalized) === next) {
        completionNoticeMutationInflight.delete(normalized);
      }
    });
  completionNoticeMutationInflight.set(normalized, next);
  return next;
}

async function withCompletionNoticeEnqueueLock(key, task) {
  const normalized = normalizeCompletionNoticeKey(key);
  if (!normalized || typeof task !== 'function') {
    return task();
  }
  const previous = completionNoticeMutationInflight.get(normalized) || Promise.resolve();
  const next = previous
    .then(async () => task())
    .finally(() => {
      if (completionNoticeMutationInflight.get(normalized) === next) {
        completionNoticeMutationInflight.delete(normalized);
      }
    });
  completionNoticeMutationInflight.set(normalized, next);
  try {
    return await next;
  } catch (error) {
    throw error;
  }
}

export async function markCompletionNoticeQueued(key, jobId) {
  const normalizedJobId = normalizeJobId(jobId);
  if (!normalizedJobId) return null;
  return updateCompletionNoticeRecord(key, async () => buildQueuedRecord(normalizedJobId));
}

export async function markCompletionNoticeDelivered(key, options = {}) {
  const deliveredAt = Number(options.deliveredAt);
  const expiresAt = Number(options.expiresAt);
  const effectiveDeliveredAt = Number.isFinite(deliveredAt) ? deliveredAt : Date.now();
  const effectiveExpiresAt = Number.isFinite(expiresAt)
    ? expiresAt
    : effectiveDeliveredAt + COMPLETION_NOTICE_TTL_MS;
  return updateCompletionNoticeRecord(
    key,
    async () => buildDeliveredRecord(effectiveExpiresAt, effectiveDeliveredAt),
  );
}

export async function clearCompletionNotice(key, options = {}) {
  const expectedJobId = normalizeJobId(options.expectedJobId);
  return updateCompletionNoticeRecord(key, async (record) => {
    if (
      expectedJobId
      && record?.status === 'queued'
      && normalizeJobId(record.jobId) !== expectedJobId
    ) {
      return record;
    }
    return null;
  });
}

export async function shouldSkipCompletionNotice(key) {
  const normalized = normalizeCompletionNoticeKey(key);
  if (!normalized) return false;
  const now = Date.now();
  const cached = completionNoticeInMemoryCache.get(normalized);
  if (cached?.status === 'queued' && hasLiveQueuedJob(cached)) {
    return true;
  }
  if (cached?.status === 'delivered' && Number.isFinite(cached.expiresAt) && cached.expiresAt > now) {
    return true;
  }
  if (cached) {
    completionNoticeInMemoryCache.delete(normalized);
  }

  const state = await readPrunedCompletionNoticeIndex(now);
  const persisted = state[normalized];
  if (persisted) return true;

  const queuedJob = await findQueuedSpeechJobByCompletionNoticeKey(normalized);
  if (queuedJob?.jobId) {
    const queuedRecord = buildQueuedRecord(queuedJob.jobId);
    completionNoticeInMemoryCache.set(normalized, queuedRecord);
    return true;
  }
  return false;
}

export async function waitForHostCompletionVoiceWorkerReady({
  child,
  timeoutMs = WORKER_READY_TIMEOUT_MS,
  pollMs = WORKER_READY_POLL_MS,
  readWorkerPidImpl = readWorkerPid,
  isPidAliveImpl = isPidAlive,
  sleepImpl = delay,
} = {}) {
  let exitError = null;
  const onError = (error) => {
    exitError = error instanceof Error ? error : new Error(String(error || 'Worker failed to start'));
  };
  const onExit = (code, signal) => {
    exitError = new Error(`Host completion voice worker exited before ready (${code ?? 'null'}${signal ? `/${signal}` : ''})`);
  };

  child?.once?.('error', onError);
  child?.once?.('exit', onExit);
  try {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() < deadline) {
      if (exitError) throw exitError;
      const pid = await readWorkerPidImpl();
      if (
        Number.isInteger(pid)
        && pid > 0
        && (pid === child?.pid || isPidAliveImpl(pid))
      ) {
        return pid;
      }
      await sleepImpl(Math.max(0, pollMs));
    }
    if (exitError) throw exitError;
    throw new Error(`Host completion voice worker did not become ready within ${timeoutMs}ms`);
  } finally {
    child?.off?.('error', onError);
    child?.off?.('exit', onExit);
  }
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
    await clearSpeechWorkerPid();
    const child = spawn(process.execPath, [resolveHostCompletionVoiceWorkerScript()], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    try {
      await waitForHostCompletionVoiceWorkerReady({ child });
      await appendWorkerLog(`[start-ok] pid="${child.pid}"`);
    } catch (error) {
      await appendWorkerLog(`[start-failed] pid="${child.pid}" message="${error?.message || error}"`);
      throw error;
    }
    child.unref?.();
  })();
  try {
    await ensureWorkerPromise;
  } finally {
    ensureWorkerPromise = null;
  }
}

export async function resumeHostCompletionSpeechQueue(options = {}) {
  const {
    ensureWorkerImpl = ensureWorker,
    kickHostCompletionSpeechDrainImpl = kickHostCompletionSpeechDrain,
    appendWorkerLogImpl = appendWorkerLog,
    listQueuedSpeechJobsImpl = listQueuedSpeechJobs,
    readWorkerPidImpl = readWorkerPid,
    isPidAliveImpl = isPidAlive,
  } = options;

  const jobs = await listQueuedSpeechJobsImpl();
  if (jobs.length === 0) return 'idle';

  try {
    await ensureWorkerImpl();
    return 'worker';
  } catch (error) {
    const latePid = await readWorkerPidImpl();
    if (isPidAliveImpl(latePid)) {
      await appendWorkerLogImpl(`[resume-recovered] pid="${latePid}" message="${error?.message || error}"`);
      return 'worker';
    }
    await appendWorkerLogImpl(`[resume-fallback] message="${error?.message || error}"`);
    void kickHostCompletionSpeechDrainImpl();
    return 'inproc';
  }
}

export async function drainHostCompletionSpeechQueue(options = {}) {
  const {
    playHostCompletionSoundImpl = playHostCompletionSound,
  } = options;

  let idleSince = 0;
  while (true) {
    const jobs = await listQueuedSpeechJobs();
    if (jobs.length === 0) {
      if (!idleSince) idleSince = Date.now();
      if (Date.now() - idleSince >= DRAIN_IDLE_GRACE_MS) break;
      await delay(DRAIN_IDLE_POLL_MS);
      continue;
    }
    idleSince = 0;
    for (const jobPath of jobs) {
      let job = null;
      try {
        job = await readQueuedSpeechJob(jobPath);
        await playHostCompletionSoundImpl(job);
        if (job?.completionNoticeKey) {
          await markCompletionNoticeDelivered(job.completionNoticeKey);
        }
        await deleteQueuedSpeechJob(jobPath);
      } catch (error) {
        const jobId = parseQueuedSpeechJobId(jobPath);
        if (job?.completionNoticeKey) {
          await clearCompletionNotice(job.completionNoticeKey, { expectedJobId: jobId });
        }
        await archiveFailedSpeechJob(jobPath, job, error);
      }
    }
  }
}

export function kickHostCompletionSpeechDrain(options = {}) {
  if (inProcessDrainPromise) return inProcessDrainPromise;
  inProcessDrainPromise = (async () => {
    await appendWorkerLog('[inproc-start]');
    try {
      await drainHostCompletionSpeechQueue(options);
      await appendWorkerLog('[inproc-ok]');
    } catch (error) {
      await appendWorkerLog(`[inproc-error] message="${error?.message || error}"`);
      throw error;
    } finally {
      inProcessDrainPromise = null;
    }
  })();
  return inProcessDrainPromise;
}

export function hasActiveHostCompletionSpeechDrain() {
  return !!inProcessDrainPromise;
}

export function startHostCompletionSpeechQueueWatchdog(options = {}) {
  if (watchdogTimer) return watchdogTimer;

  const {
    intervalMs = DEFAULT_WATCHDOG_INTERVAL_MS,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    listQueuedSpeechJobsImpl = listQueuedSpeechJobs,
    resumeHostCompletionSpeechQueueImpl = resumeHostCompletionSpeechQueue,
    appendWorkerLogImpl = appendWorkerLog,
  } = options;

  const tick = async () => {
    if (watchdogTickPromise) return watchdogTickPromise;
    watchdogTickPromise = (async () => {
      const jobs = await listQueuedSpeechJobsImpl();
      if (!Array.isArray(jobs) || jobs.length === 0) return 'idle';
      const mode = await resumeHostCompletionSpeechQueueImpl();
      await appendWorkerLogImpl(`[watchdog-resume] jobs="${jobs.length}" mode="${mode}"`);
      return mode;
    })().catch(async (error) => {
      await appendWorkerLogImpl(`[watchdog-error] message="${error?.message || error}"`);
      throw error;
    }).finally(() => {
      watchdogTickPromise = null;
    });
    return watchdogTickPromise;
  };

  const timer = setIntervalImpl(() => {
    void tick();
  }, Math.max(1000, Number(intervalMs) || DEFAULT_WATCHDOG_INTERVAL_MS));

  watchdogTimer = {
    stop() {
      clearIntervalImpl(timer);
      if (watchdogTimer?.timer === timer) {
        watchdogTimer = null;
      }
    },
    tick,
    timer,
  };
  return watchdogTimer;
}

export function stopHostCompletionSpeechQueueWatchdog() {
  watchdogTimer?.stop?.();
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
      await markCompletionNoticeQueued(completionNoticeKey, jobId);
    }
    void resumeHostCompletionSpeechQueue();
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

export async function archiveFailedSpeechJob(jobPath, job = {}, error = null) {
  const jobId = parseQueuedSpeechJobId(jobPath) || `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const archivedPath = join(FAILED_DIR, `${jobId}.json`);
  const payload = {
    ...(job && typeof job === 'object' ? job : {}),
    failedAt: new Date().toISOString(),
    errorMessage: String(error?.message || error || 'unknown error'),
  };
  await mkdir(FAILED_DIR, { recursive: true });
  await writeFile(archivedPath, JSON.stringify(payload, null, 2));
  await rm(jobPath, { force: true });
  await appendWorkerLog(`[job-failed] jobId="${jobId}" key="${payload.completionNoticeKey || ''}" archived="${archivedPath}" message="${payload.errorMessage}"`);
  return archivedPath;
}

export async function writeSpeechWorkerPid(pid) {
  await mkdir(dirname(WORKER_PID_FILE), { recursive: true });
  await writeFile(WORKER_PID_FILE, String(pid), 'utf8');
}

export async function clearSpeechWorkerPid() {
  await rm(WORKER_PID_FILE, { force: true });
}
