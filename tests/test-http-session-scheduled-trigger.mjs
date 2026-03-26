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

function randomPort() {
  return 35000 + Math.floor(Math.random() * 4000);
}

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

function request(port, method, path, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        Cookie: cookie,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json, text: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function setupTempHome() {
  const home = mkdtempSync(join(tmpdir(), 'remotelab-http-scheduled-trigger-'));
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
        id: 'fake-codex',
        name: 'Fake Codex',
        command: 'fake-codex',
        runtimeFamily: 'codex-json',
        models: [
          { id: 'sonnet', label: 'Sonnet', defaultEffort: 'low' },
          { id: 'opus', label: 'Opus', defaultEffort: 'low' },
        ],
        reasoning: { kind: 'enum', label: 'Reasoning', levels: ['low'], default: 'low' },
      },
    ], null, 2),
    'utf8',
  );
  writeFileSync(
    join(localBin, 'fake-codex'),
    `#!/usr/bin/env node
setTimeout(() => {
  console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-test' }));
  console.log(JSON.stringify({ type: 'turn.started' }));
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'scheduled trigger manual route ok' }
  }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }));
  process.exit(0);
}, 80);
`,
    'utf8',
  );
  chmodSync(join(localBin, 'fake-codex'), 0o755);

  return { home, localBin };
}

async function startServer({ home, localBin, port }) {
  const child = spawn(process.execPath, ['chat-server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${localBin}:${process.env.PATH}`,
      CHAT_PORT: String(port),
      SECURE_COOKIES: '0',
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

  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await waitFor(() => child.exitCode !== null, 'server shutdown');
}

async function createSession(port, name) {
  const res = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'fake-codex',
    name,
  });
  assert.equal(res.status, 201, 'session creation should succeed');
  return res.json.session;
}

try {
  const { home, localBin } = setupTempHome();
  const port = randomPort();
  const server = await startServer({ home, localBin, port });

  try {
    const session = await createSession(port, 'Scheduled trigger session');
    const patched = await request(port, 'PATCH', `/api/sessions/${session.id}`, {
      scheduledTriggers: [
        {
          id: 'morning_plan',
          presetId: 'morning_plan',
          enabled: true,
          label: 'Morning plan',
          recurrenceType: 'daily',
          timeOfDay: '09:00',
          timezone: 'Asia/Shanghai',
          model: 'sonnet',
          prompt: 'Please plan my day.',
        },
        {
          id: 'night_review',
          enabled: false,
          label: 'Night review',
          recurrenceType: 'interval',
          intervalMinutes: 180,
          timezone: 'Asia/Shanghai',
          prompt: 'Please review my day.',
        },
      ],
    });
    assert.equal(patched.status, 200, 'scheduled triggers PATCH should succeed');
    assert.equal(patched.json.session?.scheduledTriggers?.length, 2, 'scheduled trigger list should persist');
    assert.equal(patched.json.session?.scheduledTriggers?.[0]?.id, 'morning_plan', 'scheduled trigger ids should persist');
    assert.equal(patched.json.session?.scheduledTriggers?.[0]?.presetId, 'morning_plan', 'scheduled trigger preset ids should persist');
    assert.equal(patched.json.session?.scheduledTriggers?.[0]?.enabled, true, 'first scheduled trigger should persist enabled');
    assert.equal(patched.json.session?.scheduledTriggers?.[0]?.model, 'sonnet', 'first scheduled trigger should persist model');
    assert.equal(patched.json.session?.scheduledTriggers?.[1]?.enabled, false, 'second scheduled trigger should persist paused state');
    assert.equal(patched.json.session?.scheduledTriggers?.[1]?.recurrenceType, 'interval', 'second scheduled trigger should persist interval recurrence');
    assert.equal(patched.json.session?.scheduledTriggers?.[1]?.intervalMinutes, 180, 'second scheduled trigger should persist interval minutes');
    assert.ok(patched.json.session?.scheduledTriggers?.[0]?.nextRunAt, 'enabled triggers should compute nextRunAt');
    assert.equal(patched.json.session?.scheduledTrigger?.id, 'morning_plan', 'legacy scheduledTrigger alias should expose the primary trigger');

    const detail = await request(port, 'GET', `/api/sessions/${session.id}`);
    assert.equal(detail.status, 200, 'session detail should load');
    assert.equal(detail.json.session?.scheduledTriggers?.[1]?.prompt, 'Please review my day.', 'detail should expose the scheduled trigger list');

    const manualRun = await request(port, 'POST', `/api/sessions/${session.id}/run-scheduled-trigger`, {
      triggerId: 'morning_plan',
    });
    assert.ok(manualRun.status === 200 || manualRun.status === 202, 'manual scheduled trigger route should succeed');
    assert.equal(manualRun.json.session?.scheduledTrigger?.id, 'morning_plan', 'manual run should keep the primary trigger alias');
    assert.ok(
      ['started', 'queued'].includes(manualRun.json.session?.scheduledTrigger?.lastRunStatus),
      'manual run should persist a runtime status on the trigger',
    );

    const events = await waitFor(async () => {
      const response = await request(port, 'GET', `/api/sessions/${session.id}/events`);
      if (response.status !== 200) return false;
      const entries = response.json?.events || [];
      const hasStatus = entries.some((event) => event.type === 'status' && String(event.content || '').includes('Morning plan fired'));
      const hasAssistant = entries.some(
        (event) => event.type === 'message'
          && event.role === 'assistant'
          && event.content === 'scheduled trigger manual route ok',
      );
      return hasStatus && hasAssistant ? entries : false;
    }, 'manual scheduled trigger events');
    assert.ok(Array.isArray(events), 'manual run should append scheduler status and assistant output');

    const detailAfterManualRun = await waitFor(async () => {
      const response = await request(port, 'GET', `/api/sessions/${session.id}`);
      if (response.status !== 200) return false;
      const trigger = response.json?.session?.scheduledTrigger;
      return trigger?.lastRunStatus === 'completed' ? response : false;
    }, 'manual scheduled trigger completion state');
    assert.equal(
      detailAfterManualRun.json.session?.scheduledTrigger?.lastError || '',
      '',
      'successful scheduled runs should clear any previous error text',
    );

    const cleared = await request(port, 'PATCH', `/api/sessions/${session.id}`, {
      scheduledTriggers: null,
    });
    assert.equal(cleared.status, 200, 'scheduled trigger clear should succeed');
    assert.equal(cleared.json.session?.scheduledTriggers, undefined, 'clearing should remove the scheduled trigger list');
    assert.equal(cleared.json.session?.scheduledTrigger, undefined, 'clearing should remove the legacy scheduled trigger alias');

    const invalid = await request(port, 'PATCH', `/api/sessions/${session.id}`, {
      scheduledTriggers: [
        {
          enabled: true,
          timeOfDay: 900,
          content: 'bad',
        },
      ],
    });
    assert.equal(invalid.status, 400, 'invalid scheduled trigger payloads should be rejected');

    const legacyPatched = await request(port, 'PATCH', `/api/sessions/${session.id}`, {
      scheduledTrigger: {
        enabled: true,
        presetId: 'daily_report',
        recurrenceType: 'interval',
        intervalMinutes: 30,
        timeOfDay: '08:15',
        timezone: 'Asia/Shanghai',
        model: 'opus',
        prompt: 'Legacy single trigger',
      },
    });
    assert.equal(legacyPatched.status, 200, 'legacy single scheduled trigger PATCH should still succeed');
    assert.equal(legacyPatched.json.session?.scheduledTriggers?.length, 1, 'legacy single patch should normalize into the list shape');
    assert.equal(legacyPatched.json.session?.scheduledTrigger?.prompt, 'Legacy single trigger', 'legacy alias should still expose content');
    assert.equal(legacyPatched.json.session?.scheduledTrigger?.presetId, 'daily_report', 'legacy alias should expose preset ids');
    assert.equal(legacyPatched.json.session?.scheduledTrigger?.recurrenceType, 'interval', 'legacy alias should expose recurrence type');
    assert.equal(legacyPatched.json.session?.scheduledTrigger?.model, 'opus', 'legacy alias should expose model');

    console.log('test-http-session-scheduled-trigger: ok');
  } finally {
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
