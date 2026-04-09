#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-session-task-list-visibility-'));

process.env.HOME = tempHome;

const sessionManager = await import(
  pathToFileURL(join(repoRoot, 'backend', 'session', 'manager.mjs')).href
);

const {
  createSession,
  getSession,
  listSessions,
  killAll,
} = sessionManager;

const baseFolder = join(tempHome, 'workspace');

const primary = await createSession(baseFolder, 'codex', 'Primary task', {
  group: '收集箱',
  taskListOrigin: 'user',
  taskListVisibility: 'primary',
});

const explicitSecondary = await createSession(baseFolder, 'codex', 'Delegated follow-up', {
  taskListOrigin: 'assistant',
  taskListVisibility: 'secondary',
  sourceContext: {
    kind: 'delegate_session',
    parentSessionId: primary.id,
  },
});

const inferredSecondary = await createSession(baseFolder, 'codex', 'Branch · Investigate', {
  sourceContext: {
    kind: 'workbench_node_branch',
    parentSessionId: primary.id,
  },
});

await createSession(baseFolder, 'codex', 'sort session list', {
  systemPrompt: "You are MelodySync's hidden session-list organizer.",
});

const loadedExplicitSecondary = await getSession(explicitSecondary.id);
assert.equal(loadedExplicitSecondary?.taskListVisibility, 'secondary', 'explicit secondary visibility should be preserved');

const loadedInferredSecondary = await getSession(inferredSecondary.id);
assert.equal(loadedInferredSecondary?.taskListVisibility, 'secondary', 'child sessions should infer secondary visibility');

const allVisibleSessions = await listSessions();
assert.deepEqual(
  allVisibleSessions.map((session) => session.id),
  [inferredSecondary.id, explicitSecondary.id, primary.id],
  'general session queries should keep secondary sessions available for internal flows',
);

const primaryTaskListSessions = await listSessions({ taskListVisibility: 'primary' });
assert.deepEqual(
  primaryTaskListSessions.map((session) => session.id),
  [primary.id],
  'primary task list queries should hide secondary and hidden sessions from the main sidebar feed',
);

killAll();
rmSync(tempHome, { recursive: true, force: true });

console.log('test-session-task-list-visibility: ok');
