#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'remotelab-reply-self-check-'));
const tempBin = join(tempHome, 'bin');
const configDir = join(tempHome, '.config', 'remotelab');

mkdirSync(tempBin, { recursive: true });
mkdirSync(configDir, { recursive: true });

const fakeCodexPath = join(tempBin, 'fake-codex');
writeFileSync(
  fakeCodexPath,
  `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'main-thread' }));
console.log(JSON.stringify({ type: 'turn.started' }));
console.log(JSON.stringify({
  type: 'item.completed',
  item: {
    type: 'agent_message',
    text: '我已经分析了机制问题。下一条我可以直接给你那份极短执行守则。',
  },
}));
console.log(JSON.stringify({
  type: 'turn.completed',
  usage: { input_tokens: 1, output_tokens: 1 },
}));
setTimeout(() => process.exit(0), 20);
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
  pathToFileURL(join(repoRoot, 'backend', 'session-manager.mjs')).href
);

const {
  createSession,
  getHistory,
  getSession,
  killAll,
  sendMessage,
} = sessionManager;

async function waitFor(predicate, description, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${description}`);
}

try {
  const session = await createSession(tempHome, 'fake-codex', 'Reply Flow Without Hidden Review');

  await sendMessage(session.id, '先分析问题，再把极短执行守则真的给出来。', [], {
    tool: 'fake-codex',
    model: 'fake-model',
    effort: 'low',
  });

  await waitFor(
    async () => (await getSession(session.id))?.activity?.run?.state === 'idle',
    'session should become idle after the single visible reply',
  );

  const history = await getHistory(session.id);
  const statusTexts = history
    .filter((event) => event.type === 'status')
    .map((event) => event.content || '');
  const assistantTexts = history
    .filter((event) => event.type === 'message' && event.role === 'assistant')
    .map((event) => event.content || '');

  assert.equal(
    assistantTexts.length,
    1,
    'reply flow should keep the single visible assistant turn and not auto-continue it in the background',
  );
  assert.ok(
    assistantTexts[0]?.includes('下一条我可以直接给你那份极短执行守则'),
    'history should preserve the original assistant reply as-is',
  );
  assert.equal(
    statusTexts.some((text) => text.startsWith('Assistant self-check:')),
    false,
    'history should no longer emit hidden self-check status events',
  );
} finally {
  killAll();
  rmSync(tempHome, { recursive: true, force: true });
}

console.log('test-reply-self-check: ok');
