#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const cookie = 'session_token=test-session';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, description, timeoutMs = 10000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out: ${description}`);
}

function randomPort() {
  return 48000 + Math.floor(Math.random() * 1000);
}

function request(port, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Cookie: cookie,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch {}
          resolve({ status: res.statusCode, json, text: data });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function setupTempHome() {
  const home = mkdtempSync(join(tmpdir(), 'remotelab-structured-runtime-codex-timeout-'));
  const configDir = join(home, '.config', 'remotelab');
  const localBin = join(home, '.local', 'bin');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(localBin, { recursive: true });

  writeFileSync(
    join(configDir, 'auth.json'),
    JSON.stringify({ token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(configDir, 'auth-sessions.json'),
    JSON.stringify({
      'test-session': { expiry: Date.now() + 60 * 60 * 1000, role: 'owner' },
    }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(configDir, 'tools.json'),
    JSON.stringify([
      {
        id: 'fake-codex-timeout',
        name: 'Fake Codex Timeout',
        command: 'fake-codex-timeout',
        runtimeFamily: 'codex-json',
        models: [{ id: 'gpt-5.4', label: 'GPT-5.4' }],
        reasoning: { kind: 'enum', label: 'Reasoning', levels: ['low', 'medium', 'high'], default: 'medium' },
      },
    ], null, 2),
    'utf8',
  );
  writeFileSync(
    join(localBin, 'fake-codex-timeout'),
    `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread_fake_codex_timeout' }));
console.error('2026-03-28T17:19:33.791890Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: IO error: Operation timed out (os error 60), url: wss://chatgpt.com/backend-api/codex/responses');
console.error('2026-03-28T17:19:33.792206Z  WARN codex_core::codex: startup websocket prewarm setup failed: stream disconnected before completion: Operation timed out (os error 60)');
console.log(JSON.stringify({ type: 'turn.started' }));
setInterval(() => {}, 1000);
`,
    'utf8',
  );
  chmodSync(join(localBin, 'fake-codex-timeout'), 0o755);
  return { home };
}

async function startServer({ home, port }) {
  const child = spawn(process.execPath, ['chat-server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CHAT_PORT: String(port),
      SECURE_COOKIES: '0',
      REMOTELAB_PROVIDER_TRANSPORT_FAILURE_GRACE_MS: '250',
      REMOTELAB_PROVIDER_TERMINATION_GRACE_MS: '250',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitFor(async () => {
    try {
      const res = await request(port, 'GET', '/api/auth/me');
      return res.status === 200;
    } catch {
      return false;
    }
  }, 'server startup');

  return { child };
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await waitFor(() => server.child.exitCode !== null, 'server shutdown');
}

async function createSession(port) {
  const res = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'fake-codex-timeout',
    name: 'Structured runtime codex timeout',
    group: 'Tests',
    description: 'Codex transport timeout should fail quickly',
  });
  assert.equal(res.status, 201, 'create session should succeed');
  return res.json.session;
}

async function submitMessage(port, sessionId) {
  const res = await request(port, 'POST', `/api/sessions/${sessionId}/messages`, {
    requestId: 'req-structured-runtime-codex-timeout',
    text: 'Say hello in one word.',
    tool: 'fake-codex-timeout',
    model: 'gpt-5.4',
  });
  assert.ok(res.status === 202 || res.status === 200, 'submit message should succeed');
  return res.json.run;
}

async function waitForRunTerminal(port, runId) {
  return waitFor(async () => {
    const res = await request(port, 'GET', `/api/runs/${runId}`);
    if (res.status !== 200) return false;
    if (!['completed', 'failed', 'cancelled'].includes(res.json.run.state)) return false;
    return res.json.run;
  }, `run ${runId} terminal`);
}

const { home } = setupTempHome();
const port = randomPort();
const server = await startServer({ home, port });

try {
  const session = await createSession(port);
  const run = await submitMessage(port, session.id);
  const terminal = await waitForRunTerminal(port, run.id);

  assert.equal(terminal.state, 'failed', 'codex transport timeout should surface as a failed run');
  assert.match(
    terminal.failureReason || '',
    /codex backend connection timed out/i,
    'run failure should explain that codex transport timed out',
  );
  assert.match(
    terminal.failureReason || '',
    /failed to connect to websocket/i,
    'run failure should preserve the websocket timeout detail',
  );
  assert.match(
    terminal.result?.error || '',
    /codex backend connection timed out/i,
    'result payload should preserve the forced failure reason',
  );

  const eventsRes = await request(port, 'GET', `/api/sessions/${session.id}/events`);
  assert.equal(eventsRes.status, 200, 'events request should succeed');
  assert.ok(Array.isArray(eventsRes.json.events), 'event history should return an events array');
  assert.equal(
    eventsRes.json.events.some((event) => event.type === 'message' && event.role === 'assistant'),
    false,
    'transport timeout should not fabricate an assistant reply',
  );
  assert.equal(
    eventsRes.json.events.some((event) => event.type === 'status' && /codex backend connection timed out/i.test(event.content || '')),
    true,
    'history should include a visible timeout status',
  );

  console.log('test-structured-runtime-codex-timeout: ok');
} finally {
  await stopServer(server);
  rmSync(home, { recursive: true, force: true });
}
