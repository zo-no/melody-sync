#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const home = mkdtempSync(join(tmpdir(), 'melodysync-follow-up-startup-'));
const configDir = join(home, '.config', 'melody-sync');
const binDir = join(home, '.local', 'bin');
const fakeCodexPath = join(binDir, 'fake-codex');

mkdirSync(configDir, { recursive: true });
mkdirSync(binDir, { recursive: true });

writeFileSync(
  fakeCodexPath,
  `#!/usr/bin/env node
const delay = Number(process.env.FAKE_CODEX_DELAY_MS || '120');
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-test' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'reply from fake codex' },
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
}, delay);
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

process.env.HOME = home;
process.env.PATH = `${binDir}:${process.env.PATH}`;
process.env.FAKE_CODEX_DELAY_MS = '120';

const sessionManager = await import(
  pathToFileURL(join(repoRoot, 'backend', 'session', 'manager.mjs')).href
);
const { mutateSessionMeta } = await import(
  pathToFileURL(join(repoRoot, 'backend', 'session', 'meta-store.mjs')).href
);
const { createRun, writeRunResult } = await import(
  pathToFileURL(join(repoRoot, 'backend', 'run', 'store.mjs')).href
);

const {
  createSession,
  getHistory,
  getSession,
  killAll,
  startDetachedRunObservers,
} = sessionManager;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, description, timeoutMs = 10000, intervalMs = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out: ${description}`);
}

try {
  const session = await createSession(home, 'fake-codex', 'Follow-up queue startup recovery', {
    group: 'Tests',
    description: 'Verifies startup recovery keeps terminal unfinished runs alive long enough to drain queued follow-ups',
  });

  const completedAt = new Date().toISOString();
  const run = await createRun({
    status: {
      sessionId: session.id,
      requestId: 'req-startup-run',
      state: 'completed',
      tool: 'fake-codex',
      model: 'fake-model',
      effort: 'low',
      startedAt: completedAt,
      completedAt,
    },
    manifest: {
      sessionId: session.id,
      requestId: 'req-startup-run',
      folder: session.folder,
      tool: 'fake-codex',
      prompt: 'Synthetic startup follow-up recovery run',
      options: {
        model: 'fake-model',
        effort: 'low',
      },
    },
  });
  await writeRunResult(run.id, {
    completedAt,
    exitCode: 0,
    signal: null,
  });

  await mutateSessionMeta(session.id, (draft) => {
    draft.activeRunId = run.id;
    draft.followUpQueue = [{
      requestId: 'req-startup-follow',
      text: 'Startup queued follow-up',
      queuedAt: completedAt,
      images: [],
      tool: 'fake-codex',
      model: 'fake-model',
      effort: 'low',
    }];
    draft.updatedAt = completedAt;
    return true;
  });

  killAll();
  await startDetachedRunObservers();

  await waitFor(
    async () => {
      const current = await getSession(session.id, { includeQueuedMessages: true });
      const history = await getHistory(session.id);
      const userMessages = history.filter((event) => event.type === 'message' && event.role === 'user');
      const assistantMessages = history.filter((event) => event.type === 'message' && event.role === 'assistant');
      return current?.activity?.run?.state === 'idle'
        && current?.activity?.queue?.count === 0
        && userMessages.length === 1
        && assistantMessages.length >= 1;
    },
    'startup observers should auto-drain queued follow-up messages',
    12000,
    250,
  );

  const drainedSession = await getSession(session.id, { includeQueuedMessages: true });
  const history = await getHistory(session.id);
  const userMessages = history.filter((event) => event.type === 'message' && event.role === 'user');

  assert.equal(drainedSession?.activity?.queue?.count, 0, 'startup recovery queue should clear after the retried dispatch');
  assert.deepEqual(drainedSession?.queuedMessages, [], 'startup recovery queue should not retain the drained follow-up');
  assert.equal(userMessages.length, 1, 'startup recovery should replay the queued follow-up exactly once');
  assert.match(userMessages[0].content, /Startup queued follow-up/);

  console.log('test-session-follow-up-queue-startup-recovery: ok');
} finally {
  killAll();
  await sleep(250);
  rmSync(home, { recursive: true, force: true });
}
