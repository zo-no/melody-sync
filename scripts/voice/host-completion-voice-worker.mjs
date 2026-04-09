#!/usr/bin/env node
import {
  clearSpeechWorkerPid,
  drainHostCompletionSpeechQueue,
  writeSpeechWorkerPid,
} from '../../backend/completion-speech-queue.mjs';

await writeSpeechWorkerPid(process.pid);

try {
  await drainHostCompletionSpeechQueue();
} finally {
  await clearSpeechWorkerPid();
}
