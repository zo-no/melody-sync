#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
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
const config = await import(
  pathToFileURL(join(repoRoot, 'lib', 'config.mjs')).href
);

const {
  createSession,
  getSession,
  killAll,
  listSessions,
} = sessionManager;

const sessionsPath = config.CHAT_SESSIONS_FILE;

function readSessionsFile() {
  return JSON.parse(readFileSync(sessionsPath, 'utf8'));
}

try {
  const ownerChat = await createSession(workspace, 'codex', 'Owner chat');
  assert.equal(ownerChat.sourceId, 'chat', 'owner sessions should still default to the built-in chat source');
  assert.equal(ownerChat.sourceName, 'Chat');
  assert.equal(ownerChat.appId || '', '', 'owner sessions should not synthesize a legacy app id');

  const appOnlyGithub = await createSession(workspace, 'codex', 'GitHub issue triage', {
    appId: 'github',
    appName: 'GitHub',
    group: 'GitHub',
  });
  assert.equal(appOnlyGithub.appId, 'github', 'explicit app metadata should still round-trip');
  assert.equal(appOnlyGithub.appName, 'GitHub');
  assert.equal(appOnlyGithub.sourceId, 'chat', 'legacy app metadata should not drive the active source id');
  assert.equal(appOnlyGithub.sourceName, 'Chat');

  const githubSourceSession = await createSession(workspace, 'codex', 'GitHub issue triage', {
    appId: 'github',
    appName: 'GitHub',
    sourceId: 'github',
    sourceName: 'GitHub',
    group: 'GitHub',
  });
  assert.equal(githubSourceSession.sourceId, 'github');
  assert.equal(githubSourceSession.sourceName, 'GitHub');

  const storedAfterCreate = readSessionsFile();
  assert.equal(
    storedAfterCreate.find((entry) => entry.id === ownerChat.id)?.appId,
    undefined,
    'new owner sessions should not persist a default app id',
  );
  assert.equal(
    storedAfterCreate.find((entry) => entry.id === appOnlyGithub.id)?.appId,
    'github',
    'explicit app ids should remain as passive session metadata',
  );
  assert.equal(
    storedAfterCreate.find((entry) => entry.id === appOnlyGithub.id)?.sourceId,
    undefined,
    'app-only sessions should not silently backfill a source id',
  );

  const legacyAppOnlyId = 'legacy_app_only_session';
  const legacyExternalId = 'legacy_email_thread';
  storedAfterCreate.push({
    id: legacyAppOnlyId,
    folder: workspace,
    tool: 'codex',
    name: 'Legacy email metadata only',
    appId: 'email',
    appName: 'Email',
    created: '2026-03-10T00:00:00.000Z',
    updatedAt: '2026-03-10T00:00:00.000Z',
  });
  storedAfterCreate.push({
    id: legacyExternalId,
    folder: workspace,
    tool: 'codex',
    name: 'Legacy email thread',
    externalTriggerId: 'email-thread:legacy-root',
    created: '2026-03-10T00:01:00.000Z',
    updatedAt: '2026-03-10T00:01:00.000Z',
  });
  writeFileSync(sessionsPath, `${JSON.stringify(storedAfterCreate, null, 2)}\n`, 'utf8');

  const loadedLegacyAppOnly = await getSession(legacyAppOnlyId);
  assert.equal(loadedLegacyAppOnly?.appId, 'email', 'legacy app metadata should still be readable');
  assert.equal(
    loadedLegacyAppOnly?.sourceId,
    'chat',
    'legacy app metadata alone should no longer upgrade the active source',
  );
  assert.equal(loadedLegacyAppOnly?.sourceName, 'Chat');

  const emailReuse = await createSession(workspace, 'codex', 'Reply via email', {
    appId: 'email',
    appName: 'Email',
    sourceId: 'email',
    sourceName: 'Email',
    externalTriggerId: 'email-thread:legacy-root',
    group: 'Mail',
  });
  assert.equal(emailReuse.id, legacyExternalId, 'external trigger reuse should keep the same session id');
  assert.equal(emailReuse.sourceId, 'email', 'explicit source metadata should drive the reused session');
  assert.equal(emailReuse.sourceName, 'Email');
  assert.equal(emailReuse.appId, 'email', 'passive app metadata should still persist when explicitly supplied');
  assert.equal(emailReuse.appName, 'Email');

  const chatSessions = await listSessions({ sourceId: 'chat' });
  assert.equal(chatSessions.some((session) => session.id === ownerChat.id), true);
  assert.equal(chatSessions.some((session) => session.id === appOnlyGithub.id), true);
  assert.equal(chatSessions.some((session) => session.id === legacyAppOnlyId), true);
  assert.equal(chatSessions.some((session) => session.id === githubSourceSession.id), false);

  const githubSessions = await listSessions({ sourceId: 'github' });
  assert.deepEqual(
    githubSessions.map((session) => session.id),
    [githubSourceSession.id],
    'source-scoped listing should isolate GitHub sessions',
  );

  const emailSessions = await listSessions({ sourceId: 'email' });
  assert.deepEqual(
    emailSessions.map((session) => session.id),
    [legacyExternalId],
    'source-scoped listing should isolate email sessions',
  );
} finally {
  killAll();
  rmSync(tempHome, { recursive: true, force: true });
}

console.log('test-session-app-scope: ok');
