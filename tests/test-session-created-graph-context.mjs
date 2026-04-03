#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'session-created-graph-context-'));

mkdirSync(join(tempHome, '.config', 'remotelab'), { recursive: true });
writeFileSync(
  join(tempHome, '.config', 'remotelab', 'tools.json'),
  JSON.stringify([{ id: 'fake', name: 'Fake', command: 'fake', runtimeFamily: 'codex-json' }]),
);

process.env.HOME = tempHome;

try {
  const sessionManager = await import(
    pathToFileURL(join(repoRoot, 'chat/session-manager.mjs')).href
  );
  const history = await import(
    pathToFileURL(join(repoRoot, 'chat/history.mjs')).href
  );

  const { startDetachedRunObservers, createSession, buildPrompt, killAll } = sessionManager;
  const { loadHistory } = history;

  await startDetachedRunObservers();

  const session = await createSession(tempHome, 'fake', '');
  const events = await loadHistory(session.id, { includeBodies: true });
  const graphBootstrapEvent = events.find((event) => event?.type === 'template_context' && event?.templateName === 'graph-planning');
  assert.ok(graphBootstrapEvent, 'creating a session should append a hidden graph-planning template_context event');
  assert.match(graphBootstrapEvent.content, /\[Graph planning bootstrap\]/);
  assert.match(graphBootstrapEvent.content, /Available node kinds:/);
  assert.match(graphBootstrapEvent.content, /main \(主任务\)/);

  const prompt = await buildPrompt(session.id, session, '帮我规划一下这个任务', '', 'fake', null, {});
  assert.match(prompt, /\[Applied template context: graph-planning\]/, 'first-run prompt should include the hidden graph planning template context');
  assert.match(prompt, /Available node kinds:/);
  assert.match(prompt, /Surface slots:/);

  killAll();
  console.log('test-session-created-graph-context: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
