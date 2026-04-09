#!/usr/bin/env node
import {
  clearSpeechWorkerPid,
  deleteQueuedSpeechJob,
  listQueuedSpeechJobs,
  readQueuedSpeechJob,
  writeSpeechWorkerPid,
} from '../backend/completion-speech-queue.mjs';
import { playHostCompletionSound } from '../backend/completion-sound.mjs';

await writeSpeechWorkerPid(process.pid);

try {
  // Drain the current queue in lexical order so jobs play in enqueue order.
  while (true) {
    const jobs = await listQueuedSpeechJobs();
    if (jobs.length === 0) break;
    for (const jobPath of jobs) {
      try {
        const job = await readQueuedSpeechJob(jobPath);
        await playHostCompletionSound(job);
      } finally {
        await deleteQueuedSpeechJob(jobPath);
      }
    }
  }
} finally {
  await clearSpeechWorkerPid();
}
