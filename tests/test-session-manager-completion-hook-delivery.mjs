#!/usr/bin/env node
import assert from 'assert/strict';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { existsSync, readFileSync, rmSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const hookLogPath = join(repoRoot, '.melodysync', 'host-completion-hook.log');
const soundLogPath = join(repoRoot, '.melodysync', 'host-completion-voice.log');

rmSync(hookLogPath, { force: true });
rmSync(soundLogPath, { force: true });

const sessionManager = await import(
  pathToFileURL(join(repoRoot, 'backend', 'session-manager.mjs')).href
);

const session = await sessionManager.createSession('main', 'codex', 'completion hook delivery probe');
await sessionManager.updateSessionWorkflowState(session.id, 'waiting_user');

const waitForLog = async (path, pattern, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf8');
      if (pattern.test(content)) return content;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${path}`);
};

const hookLog = await waitForLog(hookLogPath, new RegExp(`sessionId="${session.id}"`));
const soundLog = await waitForLog(soundLogPath, /\[ok\]/);

assert.match(hookLog, new RegExp(`sessionId="${session.id}"`), 'completion hook log should record the done transition session id');
assert.match(soundLog, /\[ok\]/, 'completion sound log should record a successful local say execution');

console.log('test-session-manager-completion-hook-delivery: ok');
