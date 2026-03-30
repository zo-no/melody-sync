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
  return 40000 + Math.floor(Math.random() * 4000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, description, timeoutMs = 20000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out: ${description}`);
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
          resolve({ status: res.statusCode, headers: res.headers, json, text: data });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function buildFakeCodexScript() {
  return [
    '#!/usr/bin/env node',
    "const prompt = typeof process.argv[process.argv.length - 1] === 'string' ? process.argv[process.argv.length - 1] : '';",
    "const organizerMatch = prompt.match(/<session_organizer_input>\\n([\\s\\S]*?)\\n<\\/session_organizer_input>/);",
    'console.log(JSON.stringify({ type: "thread.started", thread_id: organizerMatch ? "thread-session-organizer" : "thread-main-run" }));',
    'console.log(JSON.stringify({ type: "turn.started" }));',
    'setTimeout(() => {',
    '  if (organizerMatch) {',
    '    const payload = JSON.parse(organizerMatch[1]);',
    '    if (!Array.isArray(payload.transcript) || payload.transcript.length === 0) {',
    '      console.log(JSON.stringify({ type: "turn.failed", error: { message: "session organizer missing transcript snapshot" } }));',
    '      return;',
    '    }',
    '    console.log(JSON.stringify({',
    '      type: "item.completed",',
    '      item: {',
    '        type: "agent_message",',
    '        text: JSON.stringify({',
    '          name: "README 整理",',
    '          group: "短期任务",',
    '          description: "整理 README 与文档导航结构。",',
    '          workflowState: "parked",',
    '          workflowPriority: "medium",',
    '          reason: "session organizer test output",',
    '        }),',
    '      },',
    '    }));',
    '    console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }));',
    '    return;',
    '  }',
    '  console.log(JSON.stringify({',
    '    type: "item.completed",',
    '    item: { type: "agent_message", text: "已完成 README 和文档导航的初步整理方案。" },',
    '  }));',
    '  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }));',
    '}, 80);',
    '',
  ].join('\n');
}

function setupTempHome() {
  const home = mkdtempSync(join(tmpdir(), 'remotelab-http-session-organize-'));
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
        models: [{ id: 'fake-model', label: 'Fake model', defaultEffort: 'low' }],
        reasoning: { kind: 'enum', label: 'Reasoning', levels: ['low'], default: 'low' },
      },
    ], null, 2),
    'utf8',
  );
  writeFileSync(join(localBin, 'fake-codex'), buildFakeCodexScript(), 'utf8');
  chmodSync(join(localBin, 'fake-codex'), 0o755);
  return { home };
}

async function startServer({ home, port }) {
  const child = spawn(process.execPath, ['chat-server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CHAT_PORT: String(port),
      REMOTELAB_CHAT_BASE_URL: `http://127.0.0.1:${port}`,
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

async function waitForRunCompletion(port, runId) {
  return waitFor(async () => {
    const runRes = await request(port, 'GET', `/api/runs/${runId}`);
    if (runRes.status !== 200) return null;
    return ['completed', 'failed', 'cancelled'].includes(runRes.json?.run?.state)
      ? runRes.json.run
      : null;
  }, 'session organize run completion');
}

const { home } = setupTempHome();
const port = randomPort();
const server = await startServer({ home, port });

try {
  const created = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'fake-codex',
    name: 'New Task',
  });
  assert.equal(created.status, 201, 'session should be created');
  const sessionId = created.json?.session?.id;
  assert.ok(sessionId, 'session id should exist');

  const firstRun = await request(port, 'POST', `/api/sessions/${sessionId}/messages`, {
    text: '整理 README 和文档导航，重点是维护性。',
    tool: 'fake-codex',
    model: 'fake-model',
    effort: 'low',
  });
  assert.equal(firstRun.status, 202, 'first visible message should start a run');
  assert.ok(firstRun.json?.run?.id, 'first run should return an id');
  const completedVisibleRun = await waitForRunCompletion(port, firstRun.json.run.id);
  assert.equal(completedVisibleRun?.state, 'completed', 'first visible run should complete');

  const beforeEvents = await request(port, 'GET', `/api/sessions/${sessionId}/events?filter=visible`);
  assert.equal(beforeEvents.status, 200, 'visible events should be readable before explicit organize');
  const beforeVisibleEvents = Array.isArray(beforeEvents.json?.events) ? beforeEvents.json.events : [];
  assert.ok(beforeVisibleEvents.length > 0, 'visible history should exist before explicit organize');

  const organize = await request(port, 'POST', `/api/sessions/${sessionId}/organize`, {
    tool: 'fake-codex',
    model: 'fake-model',
    effort: 'low',
  });
  assert.equal(organize.status, 202, 'explicit organize should start a detached run');
  assert.ok(organize.json?.run?.id, 'explicit organize should return a run id');

  const completedOrganizeRun = await waitForRunCompletion(port, organize.json.run.id);
  assert.equal(completedOrganizeRun?.state, 'completed', 'organize run should complete successfully');

  const organizedSession = await request(port, 'GET', `/api/sessions/${sessionId}`);
  assert.equal(organizedSession.status, 200, 'organized session should be readable');
  assert.equal(organizedSession.json?.session?.name, 'README 整理', 'explicit organize should update the session title');
  assert.equal(organizedSession.json?.session?.group, '短期任务', 'explicit organize should update the session group');
  assert.equal(organizedSession.json?.session?.description, '整理 README 与文档导航结构。', 'explicit organize should update the session description');
  assert.equal(organizedSession.json?.session?.workflowState, 'parked', 'explicit organize should update the workflow state');
  assert.equal(organizedSession.json?.session?.workflowPriority, 'medium', 'explicit organize should update the workflow priority');

  const afterEvents = await request(port, 'GET', `/api/sessions/${sessionId}/events?filter=visible`);
  assert.equal(afterEvents.status, 200, 'visible events should remain readable after explicit organize');
  const afterVisibleEvents = Array.isArray(afterEvents.json?.events) ? afterEvents.json.events : [];
  assert.equal(afterVisibleEvents.length, beforeVisibleEvents.length, 'explicit organize should not append visible transcript events');
  assert.equal(
    afterVisibleEvents.some((event) => JSON.stringify(event || {}).includes('session_organizer_input')),
    false,
    'explicit organize payload should not leak into the visible transcript',
  );
} finally {
  await stopServer(server);
  rmSync(home, { recursive: true, force: true });
}

console.log('test-http-session-organize: ok');
