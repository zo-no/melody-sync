#!/usr/bin/env node
import assert from 'assert/strict';
import { spawnSync } from 'child_process';
import { join } from 'path';

const repoRoot = process.cwd();
const scriptPath = join(repoRoot, 'scripts', 'voice-wake-phrase.swift');

function runExtract(transcript, phrase = '小罗小罗') {
  const result = spawnSync('swift', [
    scriptPath,
    '--phrase', phrase,
    '--test-transcript', transcript,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || `swift exited with ${result.status}`);
  return result.stdout.trim();
}

function runRecognitionError(message) {
  const result = spawnSync('swift', [
    scriptPath,
    '--test-recognition-error', message,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || `swift exited with ${result.status}`);
  return result.stdout.trim();
}

assert.equal(runExtract('小罗小罗，帮我看一下今天下午的安排'), '帮我看一下今天下午的安排');
assert.equal(runExtract('先说别的，小罗小罗，打开灯'), '打开灯');
assert.equal(runExtract('完全没说唤醒词'), '');
assert.equal(runRecognitionError('Siri and Dictation are disabled'), 'fatal');
assert.equal(runRecognitionError('temporary network issue'), 'retry');

console.log('ok - voice wake phrase trailing transcript extraction is stable');
