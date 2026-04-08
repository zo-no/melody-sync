#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-early-grouping-'));
const tempBin = join(tempHome, 'bin');
const configDir = join(tempHome, '.config', 'melody-sync');

mkdirSync(tempBin, { recursive: true });
mkdirSync(configDir, { recursive: true });

const fakeCodexPath = join(tempBin, 'fake-codex');
writeFileSync(
  fakeCodexPath,
  `#!/usr/bin/env node
const delayMs = 220;
const text = 'main task finished';

console.log(JSON.stringify({ type: 'thread.started', thread_id: 'run-thread' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text },
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
}, delayMs);
setTimeout(() => process.exit(0), delayMs + 20);
`,
  'utf8',
);
chmodSync(fakeCodexPath, 0o755);

writeFileSync(
  join(configDir, 'tools.json'),
  JSON.stringify(
    [
      {
        id: 'fake-codex',
        name: 'Fake Codex',
        command: 'fake-codex',
        runtimeFamily: 'codex-json',
        models: [{ id: 'fake-model', label: 'Fake model' }],
        reasoning: {
          kind: 'enum',
          label: 'Reasoning',
          levels: ['low'],
          default: 'low',
        },
      },
    ],
    null,
    2,
  ),
  'utf8',
);

process.env.HOME = tempHome;
process.env.PATH = `${tempBin}:${process.env.PATH}`;

const sessionManager = await import(
  pathToFileURL(join(repoRoot, 'backend', 'session', 'manager.mjs')).href
);

const {
  createSession,
  getSession,
  sendMessage,
  killAll,
} = sessionManager;

async function waitFor(predicate, description, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${description}`);
}

const session = await createSession(tempHome, 'fake-codex', 'Precise Feature Task');

await sendMessage(session.id, 'Build the new feature panel and wire the sidebar hierarchy early.', [], {
  tool: 'fake-codex',
  model: 'fake-model',
  effort: 'low',
});

await waitFor(
  async () => (await getSession(session.id))?.activity?.run?.state === 'running',
  'session should enter running state',
);

await waitFor(
  async () => {
    const current = await getSession(session.id);
    return current?.name === 'Precise Feature Task'
      && !current?.group
      && !current?.description;
  },
  'session should keep its existing title without auto grouping during the reply flow',
);

assert.equal(
  (await getSession(session.id))?.activity?.run?.state,
  'running',
  'main task should keep running without background grouping work',
);

await waitFor(
  async () => (await getSession(session.id))?.activity?.run?.state === 'idle',
  'session should finish running',
);

const finished = await getSession(session.id);
assert.equal(finished?.name, 'Precise Feature Task', 'existing titles should stay unchanged during grouping-only labeling');
assert.equal(finished?.autoRenamePending, false, 'grouping-only labeling should not reopen auto-rename');
assert.equal(finished?.group || '', '', 'finished session should not auto-group during the reply flow');
assert.equal(finished?.description || '', '', 'finished session should not auto-describe during the reply flow');

killAll();
rmSync(tempHome, { recursive: true, force: true });

console.log('test-session-early-grouping: ok');
