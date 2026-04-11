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
  assert.equal(promotedSkill.json.session?.id, skillSession.id, 'promoting a skill should upgrade the current session in place');
  assert.equal(promotedSkill.json.session?.group, '快捷按钮', 'promoting a skill should move the session into the quick-actions group');
  assert.equal(promotedSkill.json.session?.persistent?.kind, 'skill', 'promoting should persist the skill kind');
  assert.ok(promotedSkill.json.session?.persistent?.digest?.summary, 'promoting should persist a digest summary');
  assert.equal(promotedSkill.json.session?.persistent?.runtimePolicy?.manual?.mode, 'follow_current', 'skill promotion should persist the manual runtime strategy');

  const runSkill = await request(port, 'POST', `/api/sessions/${promotedSkill.json.session?.id}/run-persistent`, {});
  assert.equal(runSkill.status, 202, 'running a persistent skill should start a run');
  assert.ok(runSkill.json.run?.id, 'running a persistent skill should return a run id');

  const detailAfterRun = await request(port, 'GET', `/api/sessions/${skillSession.id}`);
  assert.equal(detailAfterRun.status, 200, 'promoted session detail should remain readable after persistent run');
  assert.equal(detailAfterRun.json.session?.persistent?.kind, 'skill', 'the original session should now hold the persistent skill metadata');
  assert.equal(detailAfterRun.json.session?.persistent?.execution?.lastTriggerKind, 'manual', 'manual persistent run should update trigger metadata');
  assert.ok(detailAfterRun.json.session?.persistent?.skill?.lastUsedAt, 'manual skill run should update last-used time');

  const recurringSession = await createSession(port, 'Recurring definition');
  const createdRecurringDirect = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'codex',
    name: 'Direct recurring',
    group: '长期任务',
    persistent: {
      kind: 'recurring_task',
      digest: {
        title: 'Direct recurring',
      },
      recurring: {
        cadence: 'daily',
        timeOfDay: '08:30',
        timezone: 'Asia/Shanghai',
      },
      loop: {
        collect: {
          sources: ['运行日志'],
          instruction: '先收集每天的新信号。',
        },
        organize: {
          instruction: '按主题整理成简报。',
        },
        use: {
          instruction: '用来驱动当天的跟进动作。',
        },
        prune: {
          instruction: '清掉重复记录。',
        },
      },
    },
  });
  assert.equal(createdRecurringDirect.status, 201, 'creating a recurring task directly should succeed');
  assert.equal(createdRecurringDirect.json.session?.group, '长期任务', 'direct recurring creation should preserve the long-task group');
  assert.equal(createdRecurringDirect.json.session?.persistent?.kind, 'recurring_task', 'direct recurring creation should persist the recurring kind');
  assert.equal(createdRecurringDirect.json.session?.persistent?.recurring?.timeOfDay, '08:30', 'direct recurring creation should persist schedule defaults');
  assert.deepEqual(
    createdRecurringDirect.json.session?.taskPoolMembership,
    {
      longTerm: {
        role: 'project',
        projectSessionId: createdRecurringDirect.json.session?.id,
        fixedNode: true,
      },
    },
    'direct recurring creation should stamp explicit long-term pool membership onto the root session',
  );
  assert.deepEqual(createdRecurringDirect.json.session?.persistent?.loop?.collect?.sources, ['运行日志'], 'direct recurring creation should persist loop collection sources');

  const projectChild = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'codex',
    name: 'Recurring child',
    sourceContext: {
      rootSessionId: createdRecurringDirect.json.session?.id,
      parentSessionId: createdRecurringDirect.json.session?.id,
    },
  });
  assert.equal(projectChild.status, 201, 'creating a long-term project child should succeed');
  const promotedRecurringChild = await request(port, 'POST', `/api/sessions/${projectChild.json.session?.id}/promote-persistent`, {
    kind: 'recurring_task',
    recurring: {
      cadence: 'daily',
      timeOfDay: '07:45',
      timezone: 'Asia/Shanghai',
    },
  });
  assert.equal(promotedRecurringChild.status, 200, 'promoting a project child to a recurring task should succeed');
  assert.deepEqual(
    promotedRecurringChild.json.session?.taskPoolMembership,
    {
      longTerm: {
        role: 'member',
        projectSessionId: createdRecurringDirect.json.session?.id,
        fixedNode: false,
        bucket: 'long_term',
      },
    },
    'recurring project children should stay inside the owning long-term list as long-term tasks',
  );

  const clearedRecurringChildTrigger = await request(port, 'PATCH', `/api/sessions/${projectChild.json.session?.id}`, {
    persistent: {
      kind: 'waiting_task',
      recurring: null,
      scheduled: null,
      knowledgeBasePath: '',
    },
  });
  assert.equal(clearedRecurringChildTrigger.status, 200, 'PATCH should clear a recurring trigger when requested');
  assert.equal(clearedRecurringChildTrigger.json.session?.persistent?.kind, 'waiting_task', 'cleared recurring child should become a waiting task');
  assert.equal(clearedRecurringChildTrigger.json.session?.persistent?.recurring, undefined, 'recurring trigger should be removed when patched to null');
  assert.equal(clearedRecurringChildTrigger.json.session?.persistent?.scheduled, undefined, 'scheduled trigger should stay absent when patched to null');
  assert.equal(clearedRecurringChildTrigger.json.session?.persistent?.knowledgeBasePath, undefined, 'empty knowledge-base path should clear the stored path');
  assert.deepEqual(
    clearedRecurringChildTrigger.json.session?.taskPoolMembership,
    {
      longTerm: {
        role: 'member',
        projectSessionId: createdRecurringDirect.json.session?.id,
        fixedNode: false,
        bucket: 'waiting',
      },
    },
    'changing a project child to a waiting task should move it into the waiting bucket',
  );

  const createdScheduledDirect = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'codex',
    name: 'Direct scheduled',
    persistent: {
      kind: 'scheduled_task',
      digest: {
        title: 'Direct scheduled',
      },
      scheduled: {
        runAt: '2026-04-11T09:30:00.000Z',
        timezone: 'Asia/Shanghai',
      },
      knowledgeBasePath: '/tmp/direct-scheduled',
      loop: {
        collect: {
          sources: ['任务清单'],
        },
        organize: {},
        use: {},
        prune: {},
      },
    },
  });
  assert.equal(createdScheduledDirect.status, 201, 'creating a scheduled task directly should succeed');
  assert.equal(createdScheduledDirect.json.session?.group, '短期任务', 'direct scheduled creation should infer the short-task group');
  assert.equal(createdScheduledDirect.json.session?.persistent?.kind, 'scheduled_task', 'direct scheduled creation should persist the scheduled kind');
  assert.equal(createdScheduledDirect.json.session?.persistent?.scheduled?.runAt, '2026-04-11T09:30:00.000Z', 'direct scheduled creation should persist the scheduled run time');
  assert.equal(createdScheduledDirect.json.session?.persistent?.knowledgeBasePath, '/tmp/direct-scheduled', 'direct scheduled creation should persist the knowledge base path');

  const clearedScheduledTrigger = await request(port, 'PATCH', `/api/sessions/${createdScheduledDirect.json.session?.id}`, {
    persistent: {
      kind: 'waiting_task',
      scheduled: null,
      recurring: null,
      knowledgeBasePath: '',
    },
  });
  assert.equal(clearedScheduledTrigger.status, 200, 'PATCH should clear a scheduled trigger when requested');
  assert.equal(clearedScheduledTrigger.json.session?.persistent?.kind, 'waiting_task', 'cleared scheduled task should become a waiting task');
  assert.equal(clearedScheduledTrigger.json.session?.persistent?.scheduled, undefined, 'scheduled trigger should be removed when patched to null');
  assert.equal(clearedScheduledTrigger.json.session?.persistent?.recurring, undefined, 'recurring trigger should stay absent when patched to null');
  assert.equal(clearedScheduledTrigger.json.session?.persistent?.knowledgeBasePath, undefined, 'empty knowledge-base path should clear the stored scheduled-task path');

  const createdWaitingDirect = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'codex',
    name: 'Direct waiting',
    persistent: {
      kind: 'waiting_task',
      digest: {
        title: 'Direct waiting',
      },
      knowledgeBasePath: '/tmp/direct-waiting',
      loop: {
        collect: {
          sources: ['用户回复'],
        },
        organize: {},
        use: {},
        prune: {},
      },
    },
  });
  assert.equal(createdWaitingDirect.status, 201, 'creating a waiting task directly should succeed');
  assert.equal(createdWaitingDirect.json.session?.group, '等待任务', 'direct waiting creation should infer the waiting group');
  assert.equal(createdWaitingDirect.json.session?.persistent?.kind, 'waiting_task', 'direct waiting creation should persist the waiting kind');
  assert.equal(createdWaitingDirect.json.session?.persistent?.knowledgeBasePath, '/tmp/direct-waiting', 'direct waiting creation should persist the knowledge base path');

  const invalidRecurringDirect = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'codex',
    name: 'Invalid recurring',
    persistent: {
      kind: 'recurring_task',
    },
  });
  assert.equal(invalidRecurringDirect.status, 400, 'creating a recurring task directly should reject missing schedule config');

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
    loop: {
      collect: {
        sources: ['任务完成记录', '用户反馈'],
        instruction: '先把一周内的变化收齐。',
      },
      organize: {
        instruction: '整理成稳定问题和机会列表。',
      },
      use: {
        instruction: '据此决定下周维护项。',
      },
      prune: {
        instruction: '删掉已经失效的旧假设。',
      },
    },
  });
  assert.equal(promotedRecurring.status, 200, 'promoting a recurring task should succeed');
  const recurringPromotedId = promotedRecurring.json.session?.id;
  assert.equal(promotedRecurring.json.session?.id, recurringSession.id, 'promoting should upgrade the current recurring session in place');
  assert.equal(promotedRecurring.json.session?.group, '长期任务', 'promoting a recurring task should move the session into the long-task group');
  assert.equal(promotedRecurring.json.session?.persistent?.kind, 'recurring_task', 'recurring promotion should persist the recurring kind');
  assert.equal(promotedRecurring.json.session?.persistent?.recurring?.timeOfDay, '09:15', 'recurring promotion should persist the schedule time');
  assert.deepEqual(promotedRecurring.json.session?.persistent?.recurring?.weekdays, [1, 4], 'recurring promotion should persist weekdays');
  assert.ok(promotedRecurring.json.session?.persistent?.recurring?.nextRunAt, 'recurring promotion should precompute the next run time');
  assert.equal(promotedRecurring.json.session?.persistent?.runtimePolicy?.schedule?.mode, 'pinned', 'recurring promotion should persist the schedule runtime strategy');
  assert.equal(promotedRecurring.json.session?.persistent?.runtimePolicy?.schedule?.runtime?.tool, 'codex', 'recurring promotion should persist the pinned schedule runtime');
  assert.deepEqual(
    promotedRecurring.json.session?.taskPoolMembership,
    {
      longTerm: {
        role: 'project',
        projectSessionId: recurringSession.id,
        fixedNode: true,
      },
    },
    'recurring promotion should also stamp explicit long-term pool membership onto the owning root session',
  );
  assert.deepEqual(promotedRecurring.json.session?.persistent?.loop?.collect?.sources, ['任务完成记录', '用户反馈'], 'recurring promotion should persist loop collection sources');
  assert.equal(promotedRecurring.json.session?.persistent?.loop?.prune?.instruction, '删掉已经失效的旧假设。', 'recurring promotion should persist pruning instructions');

  const patchedRecurring = await request(port, 'PATCH', `/api/sessions/${recurringPromotedId}`, {
    persistent: {
      state: 'paused',
      recurring: {
        cadence: 'daily',
        timeOfDay: '10:30',
        timezone: 'Asia/Shanghai',
      },
      loop: {
        use: {
          instruction: '每天整理后直接驱动当天维护任务。',
        },
        prune: {
          instruction: '把重复和过期线索清掉。',
        },
      },
    },
  });
  assert.equal(patchedRecurring.status, 200, 'PATCH should accept persistent updates');
  assert.equal(patchedRecurring.json.session?.persistent?.state, 'paused', 'PATCH should persist paused state');
  assert.equal(patchedRecurring.json.session?.persistent?.recurring?.cadence, 'daily', 'PATCH should update cadence');
  assert.equal(patchedRecurring.json.session?.persistent?.recurring?.timeOfDay, '10:30', 'PATCH should update time');
  assert.deepEqual(
    patchedRecurring.json.session?.taskPoolMembership,
    {
      longTerm: {
        role: 'project',
        projectSessionId: recurringSession.id,
        fixedNode: true,
      },
    },
    'PATCH updates should preserve explicit long-term pool membership for recurring roots',
  );
  assert.equal(patchedRecurring.json.session?.persistent?.loop?.use?.instruction, '每天整理后直接驱动当天维护任务。', 'PATCH should update loop use instructions');
  assert.equal(patchedRecurring.json.session?.persistent?.loop?.prune?.instruction, '把重复和过期线索清掉。', 'PATCH should update loop prune instructions');

  const clearedPersistent = await request(port, 'PATCH', `/api/sessions/${recurringPromotedId}`, {
    persistent: null,
  });
  assert.equal(clearedPersistent.status, 200, 'PATCH should allow clearing persistent config');
  assert.equal(clearedPersistent.json.session?.persistent, undefined, 'clearing should remove persistent metadata');
  assert.equal(clearedPersistent.json.session?.taskPoolMembership, undefined, 'clearing recurring persistence should also clear explicit long-term pool membership');

  const invalidRecurringPromotion = await request(port, 'POST', `/api/sessions/${recurringPromotedId}/promote-persistent`, {
    kind: 'recurring_task',
  });
  assert.equal(invalidRecurringPromotion.status, 409, 'recurring promotion should reject missing schedule config');

  const listed = await request(port, 'GET', '/api/sessions');
  assert.equal(listed.status, 200, 'session list should remain readable');
  const listedSkill = (listed.json.sessions || []).find((entry) => entry.id === skillSession.id);
  assert.equal(listedSkill?.persistent?.kind, 'skill', 'session list should expose persistent metadata on the original promoted session');

  console.log('test-http-session-persistent: ok');
} finally {
  await stopServer(server);
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
