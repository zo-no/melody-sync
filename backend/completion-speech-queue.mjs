import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const QUEUE_DIR = join(REPO_ROOT, '.melodysync', 'host-completion-voice-queue');
const WORKER_PID_FILE = join(REPO_ROOT, '.melodysync', 'host-completion-voice-worker.pid');
const WORKER_SCRIPT = join(REPO_ROOT, 'scripts', 'host-completion-voice-worker.mjs');
let ensureWorkerPromise = null;

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

async function ensureWorker() {
  if (ensureWorkerPromise) {
    await ensureWorkerPromise;
    return;
  }
  ensureWorkerPromise = (async () => {
  await ensureQueueDir();
  const pid = await readWorkerPid();
  if (isPidAlive(pid)) return;
  const child = spawn(process.execPath, [WORKER_SCRIPT], {
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
  await ensureQueueDir();
  const jobId = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const jobPath = join(QUEUE_DIR, `${jobId}.json`);
  const jobPayload = {
    speechText: String(payload.speechText || '').trim(),
  };
  const voice = String(payload.voice || '').trim();
  if (voice) {
    jobPayload.voice = voice;
  }
  if (Number.isFinite(payload.rate)) {
    jobPayload.rate = payload.rate;
  }
  await writeFile(jobPath, JSON.stringify(jobPayload, null, 2));
  await ensureWorker();
  return jobPath;
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
