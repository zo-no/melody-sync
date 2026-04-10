#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-early-rename-'));
const tempBin = join(tempHome, 'bin');
const configDir = join(tempHome, '.config', 'melody-sync');
const promptLogPath = join(tempHome, 'main-run-prompt.txt');

mkdirSync(tempBin, { recursive: true });
mkdirSync(configDir, { recursive: true });

const fakeCodexPath = join(tempBin, 'fake-codex');
writeFileSync(
  fakeCodexPath,
  `#!/usr/bin/env node
const fs = require('fs');
const prompt = process.argv[process.argv.length - 1] || '';
const isLabelPrompt = prompt.includes('You are naming a developer session');
const delayMs = isLabelPrompt ? 50 : 220;
const text = isLabelPrompt
  ? JSON.stringify({ title: 'Refactor naming flow' })
  : 'main task finished';

if (!isLabelPrompt) {
  fs.writeFileSync(${JSON.stringify(promptLogPath)}, prompt, 'utf8');
}

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
  sendMessage,
  killAll,
} = sessionManager;

function readPersistedSession(sessionId) {
  const sessionsPath = join(tempHome, '.melodysync', 'runtime', 'sessions', 'chat-sessions.json');
  const sessions = JSON.parse(readFileSync(sessionsPath, 'utf8'));
  return sessions.find((entry) => entry.id === sessionId) || null;
}

async function waitFor(predicate, description, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${description}`);
}

const session = await createSession(tempHome, 'fake-codex', '', {
});

await sendMessage(session.id, 'Refactor the naming flow so renaming starts immediately after the user sends a message.', [], {
  tool: 'fake-codex',
  model: 'fake-model',
  effort: 'low',
});

await waitFor(
  async () => {
    const current = readPersistedSession(session.id);
    return current?.name === 'Refactor the…'
      && !current?.group
      && !current?.description
      && current?.autoRenamePending === true;
  },
  'session should adopt the first-message draft title while keeping autoRenamePending until the final naming pass',
);

await waitFor(
  async () => existsSync(promptLogPath),
  'main task prompt should be captured',
);

const mainRunPrompt = readFileSync(promptLogPath, 'utf8');
assert.match(mainRunPrompt, /Fixed session task title: Refactor the…/, 'first-turn prompt should use the early draft title');
assert.doesNotMatch(mainRunPrompt, /Fixed session task title: new session/, 'first-turn prompt should not keep the default title');

await waitFor(
  async () => {
    const current = readPersistedSession(session.id);
    return current?.name === 'Refactor naming flow'
      && !current?.group
      && !current?.description
      && current?.autoRenamePending === false;
  },
  'session should replace the draft title with a final contextual title after the first turn completes',
);

const finished = readPersistedSession(session.id);
assert.equal(finished?.name, 'Refactor naming flow', 'finished session should adopt the final contextual title');
assert.equal(finished?.group || '', '', 'finished session should not auto-group during the reply flow');
assert.equal(finished?.description || '', '', 'finished session should not auto-describe during the reply flow');
assert.equal(finished?.autoRenamePending, false, 'final naming should clear autoRenamePending');
assert.equal(finished?.sessionState?.goal, 'Refactor naming flow', 'final rename should keep the mainline session goal aligned with the session title');
assert.equal(finished?.sessionState?.mainGoal, 'Refactor naming flow', 'final rename should keep the mainline session main goal aligned with the session title');

killAll();
rmSync(tempHome, { recursive: true, force: true });

console.log('test-session-early-rename: ok');
process.exit(0);
