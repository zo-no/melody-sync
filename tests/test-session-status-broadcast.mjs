#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const tempHome = mkdtempSync(join(tmpdir(), 'remotelab-status-broadcast-'));
const tempBin = join(tempHome, 'bin');
const configDir = join(tempHome, '.config', 'remotelab');

mkdirSync(tempBin, { recursive: true });
mkdirSync(configDir, { recursive: true });

const fakeCodexPath = join(tempBin, 'fake-codex');
writeFileSync(
  fakeCodexPath,
  `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-test' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'finished' },
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
}, 25);
setTimeout(() => process.exit(0), 40);
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
  pathToFileURL(join(repoRoot, 'chat', 'session-manager.mjs')).href
);
const wsClients = await import(
  pathToFileURL(join(repoRoot, 'chat', 'ws-clients.mjs')).href
);

const {
  createSession,
  getSession,
  getRunState,
  killAll,
  renameSession,
  submitHttpMessage,
} = sessionManager;
const { setWss } = wsClients;

function makeWs(authSession) {
  return {
    readyState: 1,
    _authSession: authSession,
    messages: [],
    send(payload) {
      this.messages.push(JSON.parse(payload));
    },
  };
}

async function waitFor(predicate, description, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${description}`);
}

const ownerWs = makeWs({ role: 'owner' });
const peerOwnerWs = makeWs({ role: 'owner' });
setWss({ clients: new Set([ownerWs, peerOwnerWs]) });

const ownerSessionA = await createSession(tempHome, 'fake-codex', 'Owner A', {
  group: 'Tests',
  description: 'Owner invalidation test A',
});
assert.equal(
  ownerWs.messages.some((msg) => msg.type === 'sessions_invalidated'),
  true,
  'creating an owner session should invalidate the owner session list',
);
ownerWs.messages = [];

await createSession(tempHome, 'fake-codex', 'Owner B', {
  group: 'Tests',
  description: 'Owner invalidation test B',
});
assert.equal(
  ownerWs.messages.some((msg) => msg.type === 'sessions_invalidated'),
  true,
  'creating another owner session should also invalidate the owner session list',
);
ownerWs.messages = [];

const ownerOutcome = await submitHttpMessage(ownerSessionA.id, 'Say hello', [], {
  requestId: 'owner-run',
  tool: 'fake-codex',
  model: 'fake-model',
  effort: 'low',
});

await waitFor(
  () => ownerWs.messages.some(
    (msg) => msg.type === 'session_invalidated' && msg.sessionId === ownerSessionA.id,
  ),
  'owner should receive invalidation for its session',
);

await waitFor(() => {
  return getRunState(ownerOutcome.run.id).then((run) => run && ['completed', 'failed', 'cancelled'].includes(run.state));
}, 'owner run should complete');

assert.equal(
  ownerWs.messages.some((msg) => ['session', 'event', 'history'].includes(msg.type)),
  false,
  'owner websocket should not receive state-bearing payloads',
);

ownerWs.messages = [];
const renamed = await renameSession(ownerSessionA.id, 'Owner A updated');
assert.ok(renamed, 'rename should succeed for owner session');
assert.equal(
  ownerWs.messages.some(
    (msg) => msg.type === 'session_invalidated' && msg.sessionId === ownerSessionA.id,
  ),
  true,
  'rename should still invalidate the affected session',
);
assert.equal(
  ownerWs.messages.some((msg) => msg.type === 'sessions_invalidated'),
  false,
  'rename should not invalidate the whole owner session list',
);

const peerSession = await createSession(tempHome, 'fake-codex', 'Peer Owner A', {
  group: 'Tests',
  description: 'Peer owner invalidation test',
});
ownerWs.messages = [];
peerOwnerWs.messages = [];

const peerOutcome = await submitHttpMessage(peerSession.id, 'Peer owner run', [], {
  requestId: 'peer-owner-run',
  tool: 'fake-codex',
  model: 'fake-model',
  effort: 'low',
});

await waitFor(
  () => peerOwnerWs.messages.some(
    (msg) => msg.type === 'session_invalidated' && msg.sessionId === peerSession.id,
  ),
  'peer owner should receive invalidation for its own session',
);

await waitFor(() => {
  return getRunState(peerOutcome.run.id).then((run) => run && ['completed', 'failed', 'cancelled'].includes(run.state));
}, 'peer owner run should complete');

assert.equal(
  ownerWs.messages.some(
    (msg) => msg.type === 'session_invalidated' && msg.sessionId === peerSession.id,
  ),
  true,
  'all owner clients should receive session invalidations for unified session views',
);

assert.equal(
  peerOwnerWs.messages.some((msg) => ['session', 'event', 'history'].includes(msg.type)),
  false,
  'owner websocket should stay invalidation-only',
);

await waitFor(
  async () => (await getSession(ownerSessionA.id))?.workflowState === 'done',
  'owner session workflow state suggestion should settle before cleanup',
);
await waitFor(
  async () => (await getSession(peerSession.id))?.workflowState === 'done',
  'peer session workflow state suggestion should settle before cleanup',
);

killAll();
setWss({ clients: new Set() });
rmSync(tempHome, { recursive: true, force: true });

console.log('test-session-status-broadcast: ok');
