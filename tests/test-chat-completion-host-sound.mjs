#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const sessionHttpPath = existsSync(join(repoRoot, 'frontend-src', 'session', 'http.js'))
  ? join(repoRoot, 'frontend-src', 'session', 'http.js')
  : join(repoRoot, 'static', 'frontend', 'session', 'http.js');
const sessionHttpSource = readFileSync(sessionHttpPath, 'utf8');

function extractFunctionSource(code, functionName) {
  const marker = `function ${functionName}`;
  const start = code.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = code.indexOf('(', start);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < code.length; index += 1) {
    const char = code[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = code.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(bodyStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < code.length; index += 1) {
    const char = code[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(start, index + 1);
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

const requestHostCompletionSoundSource = extractFunctionSource(sessionHttpSource, 'requestHostCompletionSound');
const getCompletionStampSource = extractFunctionSource(sessionHttpSource, 'getCompletionStamp');
const buildCompletionNoticeKeySource = extractFunctionSource(sessionHttpSource, 'buildCompletionNoticeKey');
const isLikelyMobileClientSource = extractFunctionSource(sessionHttpSource, 'isLikelyMobileClient');
const shouldPlayCompletionSoundLocallySource = extractFunctionSource(sessionHttpSource, 'shouldPlayCompletionSoundLocally');
const shouldRequestHostCompletionSoundSource = extractFunctionSource(sessionHttpSource, 'shouldRequestHostCompletionSound');
const playCompletionSoundSource = extractFunctionSource(sessionHttpSource, 'playCompletionSound');

const fetchCalls = [];
const browserFallbacks = [];
const context = {
  console,
  navigator: {
    userAgent: 'Desktop Chrome',
  },
  window: {
    fetch(url, options = {}) {
      fetchCalls.push({ url, options });
      return Promise.resolve({ ok: true });
    },
    matchMedia() {
      return { matches: false };
    },
  },
  playBrowserCompletionSound() {
    browserFallbacks.push('fallback');
  },
};
context.globalThis = context;

vm.runInNewContext(`
  ${getCompletionStampSource}
  ${buildCompletionNoticeKeySource}
  ${requestHostCompletionSoundSource}
  ${isLikelyMobileClientSource}
  ${shouldPlayCompletionSoundLocallySource}
  ${shouldRequestHostCompletionSoundSource}
  ${playCompletionSoundSource}
  globalThis.playCompletionSound = playCompletionSound;
`, context, {
  filename: 'frontend-src/session/http.js',
});

context.playCompletionSound();
await flushMicrotasks();

assert.equal(fetchCalls.length, 0, 'desktop clients should not request host completion sound playback');
assert.deepEqual(browserFallbacks, ['fallback'], 'desktop clients should fall back to browser audio');

fetchCalls.length = 0;
browserFallbacks.length = 0;
context.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/135.0 Mobile Safari/537.36';
context.window.fetch = (url, options = {}) => {
  fetchCalls.push({ url, options });
  return Promise.resolve({ ok: true });
};
context.playCompletionSound();
await flushMicrotasks();

assert.equal(fetchCalls.length, 1, 'mobile clients should also request the host completion sound endpoint');
assert.equal(fetchCalls[0].url, '/api/system/completion-sound');
assert.equal(fetchCalls[0].options.method, 'POST');
assert.equal(fetchCalls[0].options.credentials, 'same-origin');
assert.deepEqual(browserFallbacks, ['fallback'], 'mobile clients should still play a local browser sound even when host playback succeeds');

fetchCalls.length = 0;
browserFallbacks.length = 0;
context.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/135.0 Mobile Safari/537.36';
context.window.fetch = (url, options = {}) => {
  fetchCalls.push({ url, options });
  return Promise.resolve({ ok: false });
};
context.playCompletionSound();
await flushMicrotasks();

assert.equal(fetchCalls.length, 1, 'failed mobile host playback should still attempt one host request');
assert.deepEqual(browserFallbacks, ['fallback'], 'failed host sound playback should still fall back to browser audio');

console.log('test-chat-completion-host-sound: ok');
