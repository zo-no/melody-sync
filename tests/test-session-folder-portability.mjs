#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
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
  return 49000 + Math.floor(Math.random() * 1000);
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
  const home = mkdtempSync(join(tmpdir(), 'melodysync-session-folder-portability-'));
  const configDir = join(home, '.config', 'melody-sync');
  const localBin = join(home, '.local', 'bin');
  const sessionsDir = join(home, '.melodysync', 'runtime', 'sessions');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(localBin, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });

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
        id: 'fake-codex-ok',
        name: 'Fake Codex OK',
        command: 'fake-codex-ok',
        runtimeFamily: 'codex-json',
        models: [{ id: 'gpt-5.4', label: 'GPT-5.4' }],
        reasoning: { kind: 'enum', label: 'Reasoning', levels: ['low', 'medium', 'high'], default: 'medium' },
      },
    ], null, 2),
    'utf8',
  );
  writeFileSync(
    join(localBin, 'fake-codex-ok'),
    `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread_fake_codex_ok' }));
console.log(JSON.stringify({ type: 'turn.started' }));
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'portable-session-ok' } }));
console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 4 } }));
`,
    'utf8',
  );
  chmodSync(join(localBin, 'fake-codex-ok'), 0o755);

  const sessionsFile = join(sessionsDir, 'chat-sessions.json');
  writeFileSync(
    sessionsFile,
    `${JSON.stringify([
      {
        id: 'broken-session',
        folder: '/Users/legacy/missing-project',
        tool: 'fake-codex-ok',
        name: 'Broken migrated session',
        created: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z',
      },
      {
        id: 'portable-persistent-session',
        folder: '/Users/legacy/missing-project',
        tool: 'fake-codex-ok',
        name: 'Migrated recurring task',
        group: '长期任务',
        created: '2026-04-08T00:01:00.000Z',
        updatedAt: '2026-04-08T00:01:00.000Z',
        persistent: {
          kind: 'recurring_task',
          state: 'active',
          digest: {
            title: 'Migrated recurring task',
            summary: 'Keep this task runnable after machine migration.',
            goal: 'Repair the working directory automatically.',
            keyPoints: ['Originated on another machine.'],
            recipe: ['Run with the current machine context.'],
          },
          execution: {
            runPrompt: 'Please continue from the migrated long-term task definition.',
          },
          recurring: {
            cadence: 'daily',
            timeOfDay: '09:00',
            timezone: 'Asia/Shanghai',
            nextRunAt: '2026-04-08T00:00:00.000Z',
          },
        },
      },
    ], null, 2)}\n`,
    'utf8',
  );

  return { home, sessionsFile, localBin };
}

async function startServer({ home, localBin, port }) {
  const child = spawn(process.execPath, ['chat-server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${localBin}:${process.env.PATH || ''}`,
      CHAT_PORT: String(port),
      SECURE_COOKIES: '0',
      MELODYSYNC_DISABLE_ACTIVE_RELEASE: '1',
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

async function waitForRunTerminal(port, runId) {
  return waitFor(async () => {
    const res = await request(port, 'GET', `/api/runs/${runId}`);
    if (res.status !== 200) return false;
    if (!['completed', 'failed', 'cancelled'].includes(res.json.run.state)) return false;
    return res.json.run;
  }, `run ${runId} terminal`);
}

const { home, sessionsFile, localBin } = setupTempHome();
const port = randomPort();
const server = await startServer({ home, localBin, port });

try {
  const brokenSubmit = await request(port, 'POST', '/api/sessions/broken-session/messages', {
    requestId: 'req-broken-session-folder',
    text: 'Try to run with a broken working directory.',
    tool: 'fake-codex-ok',
    model: 'gpt-5.4',
  });
  assert.equal(brokenSubmit.status, 409, 'broken non-persistent session should fail before spawning a run');
  assert.match(
    brokenSubmit.json?.error || '',
    /working directory does not exist on this machine/i,
    'error should explain that the saved session folder is invalid on this machine',
  );
  assert.match(
    brokenSubmit.json?.error || '',
    /\/Users\/legacy\/missing-project/,
    'error should preserve the broken folder path for debugging',
  );

  const runPersistent = await request(port, 'POST', '/api/sessions/portable-persistent-session/run-persistent', {});
  assert.equal(runPersistent.status, 202, 'migrated persistent session should auto-repair and still run');
  assert.ok(runPersistent.json?.run?.id, 'persistent run should return a run id');

  const terminal = await waitForRunTerminal(port, runPersistent.json.run.id);
  assert.equal(terminal.state, 'completed', 'auto-repaired persistent session should complete normally');

  const detail = await request(port, 'GET', '/api/sessions/portable-persistent-session');
  assert.equal(detail.status, 200, 'session detail should remain readable');
  assert.equal(detail.json?.session?.folder, '~', 'migrated persistent session should persist the repaired home-relative folder');

  const storedSessions = JSON.parse(readFileSync(sessionsFile, 'utf8'));
  assert.equal(
    storedSessions.find((entry) => entry.id === 'portable-persistent-session')?.folder,
    '~',
    'folder repair should be saved back to session storage',
  );

  const eventsRes = await request(port, 'GET', '/api/sessions/portable-persistent-session/events');
  assert.equal(eventsRes.status, 200, 'events request should succeed');
  assert.equal(
    eventsRes.json.events.some((event) => event.type === 'message' && event.role === 'assistant' && /portable-session-ok/.test(event.content || '')),
    true,
    'persistent run should still emit the assistant reply after auto-repair',
  );

  console.log('test-session-folder-portability: ok');
} finally {
  await stopServer(server);
  rmSync(home, { recursive: true, force: true });
}
