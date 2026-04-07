#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const cookie = 'session_token=test-session';

function randomPort() {
  return 37800 + Math.floor(Math.random() * 1000);
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

function request(port, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        Cookie: cookie,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
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
  const home = mkdtempSync(join(tmpdir(), 'melodysync-http-session-persistent-'));
  const configDir = join(home, '.config', 'melody-sync');
  mkdirSync(configDir, { recursive: true });

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

  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await waitFor(() => child.exitCode !== null, 'server shutdown');
}

async function createSession(port, name) {
  const created = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'codex',
    name,
  });
  assert.equal(created.status, 201, 'session creation should succeed');
  return created.json.session;
}

const { home } = setupTempHome();
const port = randomPort();
const server = await startServer({ home, port });

try {
  const skillSession = await createSession(port, 'Skill definition');

  const promotedSkill = await request(port, 'POST', `/api/sessions/${skillSession.id}/promote-persistent`, {
    kind: 'skill',
    runtimePolicy: {
      manual: {
        mode: 'follow_current',
      },
    },
  });
  assert.equal(promotedSkill.status, 200, 'promoting a skill should succeed');
  assert.notEqual(promotedSkill.json.session?.id, skillSession.id, 'promoting should create a new skill session');
  assert.equal(promotedSkill.json.session?.group, '快捷按钮', 'promoting a skill should move the session into the quick-actions group');
  assert.equal(promotedSkill.json.session?.persistent?.kind, 'skill', 'promoting should persist the skill kind');
  assert.ok(promotedSkill.json.session?.persistent?.digest?.summary, 'promoting should persist a digest summary');
  assert.equal(promotedSkill.json.session?.persistent?.runtimePolicy?.manual?.mode, 'follow_current', 'skill promotion should persist the manual runtime strategy');

  const runSkill = await request(port, 'POST', `/api/sessions/${promotedSkill.json.session?.id}/run-persistent`, {});
  assert.equal(runSkill.status, 202, 'running a persistent skill should start a run');
  assert.ok(runSkill.json.run?.id, 'running a persistent skill should return a run id');

  const detailAfterRun = await request(port, 'GET', `/api/sessions/${skillSession.id}`);
  assert.equal(detailAfterRun.status, 200, 'original session detail should remain readable after persistent run');
  assert.equal(detailAfterRun.json.session?.persistent, undefined, 'original session should remain non-persistent');

  const promotedSkillDetail = await request(port, 'GET', `/api/sessions/${promotedSkill.json.session?.id}`);
  assert.equal(promotedSkillDetail.status, 200, 'promoted skill session should be readable after run');
  assert.equal(promotedSkillDetail.json.session?.persistent?.execution?.lastTriggerKind, 'manual', 'manual persistent run should update trigger metadata');
  assert.ok(promotedSkillDetail.json.session?.persistent?.skill?.lastUsedAt, 'manual skill run should update last-used time');

  const recurringSession = await createSession(port, 'Recurring definition');
  const promotedRecurring = await request(port, 'POST', `/api/sessions/${recurringSession.id}/promote-persistent`, {
    kind: 'recurring_task',
    recurring: {
      cadence: 'weekly',
      timeOfDay: '09:15',
      weekdays: [1, 4],
      timezone: 'Asia/Shanghai',
    },
    runtimePolicy: {
      manual: {
        mode: 'follow_current',
      },
      schedule: {
        mode: 'pinned',
        runtime: {
          tool: 'codex',
          model: 'gpt-5-codex',
          effort: 'medium',
          thinking: false,
        },
      },
    },
  });
  assert.equal(promotedRecurring.status, 200, 'promoting a recurring task should succeed');
  const recurringPromotedId = promotedRecurring.json.session?.id;
  assert.notEqual(promotedRecurring.json.session?.id, recurringSession.id, 'promoting should create a distinct recurring session');
  assert.equal(promotedRecurring.json.session?.group, '长期任务', 'promoting a recurring task should move the session into the long-task group');
  assert.equal(promotedRecurring.json.session?.persistent?.kind, 'recurring_task', 'recurring promotion should persist the recurring kind');
  assert.equal(promotedRecurring.json.session?.persistent?.recurring?.timeOfDay, '09:15', 'recurring promotion should persist the schedule time');
  assert.deepEqual(promotedRecurring.json.session?.persistent?.recurring?.weekdays, [1, 4], 'recurring promotion should persist weekdays');
  assert.ok(promotedRecurring.json.session?.persistent?.recurring?.nextRunAt, 'recurring promotion should precompute the next run time');
  assert.equal(promotedRecurring.json.session?.persistent?.runtimePolicy?.schedule?.mode, 'pinned', 'recurring promotion should persist the schedule runtime strategy');
  assert.equal(promotedRecurring.json.session?.persistent?.runtimePolicy?.schedule?.runtime?.tool, 'codex', 'recurring promotion should persist the pinned schedule runtime');

  const patchedRecurring = await request(port, 'PATCH', `/api/sessions/${recurringPromotedId}`, {
    persistent: {
      state: 'paused',
      recurring: {
        cadence: 'daily',
        timeOfDay: '10:30',
        timezone: 'Asia/Shanghai',
      },
    },
  });
  assert.equal(patchedRecurring.status, 200, 'PATCH should accept persistent updates');
  assert.equal(patchedRecurring.json.session?.persistent?.state, 'paused', 'PATCH should persist paused state');
  assert.equal(patchedRecurring.json.session?.persistent?.recurring?.cadence, 'daily', 'PATCH should update cadence');
  assert.equal(patchedRecurring.json.session?.persistent?.recurring?.timeOfDay, '10:30', 'PATCH should update time');

  const clearedPersistent = await request(port, 'PATCH', `/api/sessions/${recurringPromotedId}`, {
    persistent: null,
  });
  assert.equal(clearedPersistent.status, 200, 'PATCH should allow clearing persistent config');
  assert.equal(clearedPersistent.json.session?.persistent, undefined, 'clearing should remove persistent metadata');

  const invalidRecurringPromotion = await request(port, 'POST', `/api/sessions/${recurringPromotedId}/promote-persistent`, {
    kind: 'recurring_task',
  });
  assert.equal(invalidRecurringPromotion.status, 409, 'recurring promotion should reject missing schedule config');

  const listed = await request(port, 'GET', '/api/sessions');
  assert.equal(listed.status, 200, 'session list should remain readable');
  const listedSkill = (listed.json.sessions || []).find((entry) => entry.id === skillSession.id);
  assert.equal(listedSkill?.persistent, undefined, 'original skill session should not expose persistent metadata');
  const listedPersistentSkill = (listed.json.sessions || []).find((entry) => entry.id === promotedSkill.json.session?.id);
  assert.equal(listedPersistentSkill?.persistent?.kind, 'skill', 'session list should expose persistent metadata for promoted sessions');

  console.log('test-http-session-persistent: ok');
} finally {
  await stopServer(server);
  rmSync(home, { recursive: true, force: true });
}
