#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'session-created-graph-context-'));

mkdirSync(join(tempHome, '.config', 'melody-sync'), { recursive: true });
writeFileSync(
  join(tempHome, '.config', 'melody-sync', 'tools.json'),
  JSON.stringify([{ id: 'fake', name: 'Fake', command: 'fake', runtimeFamily: 'codex-json' }]),
);

process.env.HOME = tempHome;

try {
  const sessionManager = await import(
    pathToFileURL(join(repoRoot, 'backend/session/manager.mjs')).href
  );
  const history = await import(
    pathToFileURL(join(repoRoot, 'backend/history.mjs')).href
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
  assert.match(graphBootstrapEvent.content, /main \(入口任务\)/);
  assert.match(graphBootstrapEvent.content, /<private><graph_ops>/);

  const prompt = await buildPrompt(session.id, session, '帮我规划一下这个任务', '', 'fake', null, {});
  assert.match(prompt, /\[Applied template context: graph-planning\]/, 'first-run prompt should include the hidden graph planning template context');
  assert.match(prompt, /Available node kinds:/);
  assert.match(prompt, /Surface slots:/);
  assert.match(prompt, /Supported graph ops are attach, promote_main, archive, and expand/);

  killAll();
  console.log('test-session-created-graph-context: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
