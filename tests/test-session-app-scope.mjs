#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-session-app-scope-'));
process.env.HOME = tempHome;

const workspace = join(tempHome, 'workspace');
mkdirSync(workspace, { recursive: true });

const sessionManager = await import(
  pathToFileURL(join(repoRoot, 'backend', 'session', 'manager.mjs')).href
);

const {
  createSession,
  killAll,
  listSessions,
} = sessionManager;

try {
  // Default chat session — sourceId defaults to 'chat' in API projection
  const ownerChat = await createSession(workspace, 'codex', 'Owner chat');
  assert.equal(ownerChat.sourceId, 'chat', 'owner sessions default to chat sourceId in API projection');
  assert.equal(ownerChat.appId, undefined, 'appId should not exist on new sessions');
  assert.equal(ownerChat.appName, undefined, 'appName should not exist on new sessions');
  assert.equal(ownerChat.userId, undefined, 'userId should not exist on new sessions');
  assert.equal(ownerChat.userName, undefined, 'userName should not exist on new sessions');

  // Explicit sourceId is preserved
  const githubSession = await createSession(workspace, 'codex', 'GitHub issue triage', {
    sourceId: 'github',
    sourceName: 'GitHub',
    group: 'GitHub',
  });
  assert.equal(githubSession.sourceId, 'github');
  assert.equal(githubSession.sourceName, 'GitHub');

  // Legacy appId/appName input is mapped to sourceId/sourceName
  const legacyAppSession = await createSession(workspace, 'codex', 'Email via legacy API', {
    appId: 'email',
    appName: 'Email',
  });
  assert.equal(legacyAppSession.sourceId, 'email', 'legacy appId input should map to sourceId');
  assert.equal(legacyAppSession.sourceName, 'Email', 'legacy appName input should map to sourceName');
  assert.equal(legacyAppSession.appId, undefined, 'appId should not be stored');
  assert.equal(legacyAppSession.appName, undefined, 'appName should not be stored');

  // sourceId filtering works
  const githubSessions = await listSessions({ sourceId: 'github' });
  assert.equal(githubSessions.some((s) => s.id === githubSession.id), true);
  assert.equal(githubSessions.some((s) => s.id === ownerChat.id), false);

  const emailSessions = await listSessions({ sourceId: 'email' });
  assert.equal(emailSessions.some((s) => s.id === legacyAppSession.id), true);
} finally {
  killAll();
  rmSync(tempHome, { recursive: true, force: true });
}

console.log('test-session-app-scope: ok');
