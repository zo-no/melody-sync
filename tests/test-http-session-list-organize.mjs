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
const SESSION_LIST_ORGANIZER_INTERNAL_ROLE = 'session_list_organizer';
const SESSION_LIST_ORGANIZER_SYSTEM_PROMPT = [
  'You are MelodySync\'s hidden session-list organizer.',
  'Your job is to organize the owner\'s non-archived MelodySync tasks into stable sidebar groups and ordering.',
  'Do not rename tasks casually, delete them, change pin state, edit prompts, or ask the user follow-up questions.',
  'Only update existing sessions by calling the owner-authenticated MelodySync API from this machine.',
  'Use `melodysync api GET /api/sessions` if you need to double-check current state.',
  'Use `melodysync api PATCH /api/sessions/<sessionId> --body ...` to update `name`, `group`, and `sidebarOrder`.',
  'Only writable API fields for this task are `name`, `group`, and `sidebarOrder`.',
  'Never send read-only snapshot keys such as `title`, `brief`, `existingGroup`, and `existingSidebarOrder`, `currentGroup`, or `currentSidebarOrder` in PATCH bodies.',
  'Rename only when the current task name is generic, stale, or clearly weaker than the metadata snapshot.',
  'Keep group labels concise, stable, and task-shaped. Do not create a different group for every task.',
  'Follow the folder strategy provided in the task body. Use only the provided user folders plus the fallback folder.',
  'Example PATCH body: {"name":"电影史学习路线","group":"研究任务","sidebarOrder":3}',
  'If `melodysync` is unavailable in PATH, use `node "$MELODYSYNC_PROJECT_ROOT/cli.js" api ...` instead.',
  '`sidebarOrder` must be a positive integer; smaller numbers sort first.',
  'Assign unique contiguous `sidebarOrder` values across the current non-archived sessions you organize.',
  'Default newly created or unclear work to the provided fallback group instead of inventing noisy categories.',
  'Return only a brief plain-text summary of the grouping strategy you applied.',
].join('\n');

function buildSessionListOrganizerTask(sessions = []) {
  return [
    'Organize the current non-archived MelodySync task list using the provided metadata snapshot.',
    'Use only these exact user-created folders, in this order: 收集箱, 知识库内容. If no folder fits, use 未分类.',
    'Improve sidebar ordering inside the chosen groups, and rename tasks only when the current title is weak.',
    'Apply changes by calling the MelodySync API from this machine; do not merely suggest them.',
    'Snapshot fields like `title`, `brief`, `existingGroup`, and `existingSidebarOrder` are read-only context.',
    'When patching a session, send only `name`, `group`, and `sidebarOrder` in the API body.',
    'If a task does not fit any user folder, use 未分类.',
    '',
    '<session_list_organizer_input>',
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      strategy: {
        mode: 'user_template',
        fallbackGroup: '未分类',
        templateGroups: ['收集箱', '知识库内容'],
      },
      totalSessions: Array.isArray(sessions) ? sessions.length : 0,
      sessions: Array.isArray(sessions) ? sessions : [],
    }, null, 2),
    '</session_list_organizer_input>',
  ].join('\n');
}

function randomPort() {
  return 36000 + Math.floor(Math.random() * 4000);
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
    "const { execFile } = require('child_process');",
    "const { promisify } = require('util');",
    'const execFileAsync = promisify(execFile);',
    "const prompt = typeof process.argv[process.argv.length - 1] === 'string' ? process.argv[process.argv.length - 1] : '';",
    "const organizerMatch = prompt.match(/<session_list_organizer_input>\\n([\\s\\S]*?)\\n<\\/session_list_organizer_input>/);",
    'console.log(JSON.stringify({ type: "thread.started", thread_id: "thread-session-list-organizer" }));',
    'console.log(JSON.stringify({ type: "turn.started" }));',
    'setTimeout(() => {',
    '  void (async () => {',
    '    try {',
    '      if (organizerMatch) {',
    '        if (!prompt.includes("Only writable API fields for this task are `name`, `group`, and `sidebarOrder`.")) {',
    '          throw new Error("organizer prompt missing writable field guidance");',
    '        }',
    '        if (!prompt.includes("Never send read-only snapshot keys such as `title`, `brief`, `existingGroup`, and `existingSidebarOrder`, `currentGroup`, or `currentSidebarOrder` in PATCH bodies.")) {',
    '          throw new Error("organizer prompt missing read-only field guidance");',
    '        }',
    '        if (!prompt.includes("Snapshot fields like `title`, `brief`, `existingGroup`, and `existingSidebarOrder` are read-only context.")) {',
    '          throw new Error("organizer task missing snapshot field guidance");',
    '        }',
    '        if (!prompt.includes("Use only these exact user-created folders, in this order: 收集箱, 知识库内容. If no folder fits, use 未分类.")) {',
    '          throw new Error("organizer task missing folder strategy guidance");',
    '        }',
    '        const payload = JSON.parse(organizerMatch[1]);',
    '        const sessions = Array.isArray(payload.sessions) ? payload.sessions.slice() : [];',
    '        if (payload?.strategy?.mode !== "user_template") {',
    '          throw new Error("organizer payload should include the folder grouping strategy");',
    '        }',
    '        if (sessions.some((session) => Object.prototype.hasOwnProperty.call(session, "currentGroup") || Object.prototype.hasOwnProperty.call(session, "currentSidebarOrder"))) {',
    '          throw new Error("organizer payload should use existing* snapshot fields");',
    '        }',
    '        const projectRoot = process.env.MELODYSYNC_PROJECT_ROOT || process.cwd();',
    '        const baseUrl = process.env.MELODYSYNC_CHAT_BASE_URL || `http://127.0.0.1:${process.env.CHAT_PORT || "7760"}`;',
    '        const cliPath = `${projectRoot}/cli.js`;',
    '        sessions.sort((left, right) => String(left.title || "").localeCompare(String(right.title || "")));',
    '        for (let index = 0; index < sessions.length; index += 1) {',
    '          const session = sessions[index];',
    '          const title = String(session.title || "");',
    '          const group = /quartz/i.test(title) ? "知识库内容" : "收集箱";',
    '          const name = /workflow cleanup/i.test(title) ? "整理会话工作流" : title;',
    '          await execFileAsync(process.execPath, [',
    '            cliPath,',
    '            "api",',
    '            "PATCH",',
    '            `/api/sessions/${session.id}`,',
    '            "--base-url",',
    '            baseUrl,',
    '            "--body",',
    '            JSON.stringify({ name, group, sidebarOrder: index + 1 }),',
    '          ], {',
    '            cwd: projectRoot,',
    '            env: process.env,',
    '            maxBuffer: 1024 * 1024,',
    '          });',
    '        }',
    '      }',
    '      console.log(JSON.stringify({',
    '        type: "item.completed",',
    '        item: { type: "agent_message", text: "organized session list" },',
    '      }));',
    '      console.log(JSON.stringify({',
    '        type: "turn.completed",',
    '        usage: { input_tokens: 1, output_tokens: 1 },',
    '      }));',
    '    } catch (error) {',
    '      console.log(JSON.stringify({',
    '        type: "turn.failed",',
    '        error: { message: error && error.message ? error.message : String(error) },',
    '      }));',
    '    }',
    '  })();',
    '}, 80);',
    '',
  ].join('\n');
}

function setupTempHome() {
  const home = mkdtempSync(join(tmpdir(), 'melodysync-http-session-list-organize-'));
  const configDir = join(home, '.config', 'melody-sync');
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
  return { home, configDir };
}

function readJsonFromCandidates(paths) {
  for (const path of paths) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {}
  }
  throw new Error(`Unable to read JSON from any candidate path:\n${paths.join('\n')}`);
}

async function startServer({ home, port }) {
  const child = spawn(process.execPath, ['chat-server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CHAT_PORT: String(port),
      MELODYSYNC_CHAT_BASE_URL: `http://127.0.0.1:${port}`,
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
  }, 'organizer run completion');
}

const { home, configDir } = setupTempHome();
const port = randomPort();
const server = await startServer({ home, port });

try {
  const primarySession = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'fake-codex',
    name: 'MelodySync workflow cleanup',
  });
  assert.equal(primarySession.status, 201, 'first session should be created');

  const quartzSession = await request(port, 'POST', '/api/sessions', {
    folder: repoRoot,
    tool: 'fake-codex',
    name: 'Quartz publish flow',
  });
  assert.equal(quartzSession.status, 201, 'second session should be created');

  const legacyOrganize = await request(port, 'POST', '/api/session-list/organize', {
    sessions: [],
  });
  assert.equal(legacyOrganize.status, 404, 'legacy organizer endpoint should be removed');

  const organizerSession = await request(port, 'POST', '/api/sessions', {
    folder: '~',
    tool: 'fake-codex',
    name: 'sort session list',
    systemPrompt: SESSION_LIST_ORGANIZER_SYSTEM_PROMPT,
    internalRole: SESSION_LIST_ORGANIZER_INTERNAL_ROLE,
  });
  assert.equal(organizerSession.status, 201, 'hidden organizer session should be created through the generic session API');

  const organize = await request(port, 'POST', `/api/sessions/${organizerSession.json.session.id}/messages`, {
    text: buildSessionListOrganizerTask([
      {
        id: primarySession.json.session.id,
        title: 'MelodySync workflow cleanup',
        brief: 'Clean up the session grouping and structure.',
        existingGroup: '',
        existingSidebarOrder: null,
      },
      {
        id: quartzSession.json.session.id,
        title: 'Quartz publish flow',
        brief: 'Polish the publishing workflow and docs.',
        existingGroup: '',
        existingSidebarOrder: null,
      },
    ]),
    model: 'fake-model',
    effort: 'low',
  });
  assert.equal(organize.status, 202, 'organizer trigger should start a hidden run');
  assert.ok(organize.json?.run?.id, 'organizer trigger should return a run id');

  const completedRun = await waitForRunCompletion(port, organize.json.run.id);
  assert.equal(completedRun?.state, 'completed', 'organizer run should complete successfully');

  const organizerManifest = readJsonFromCandidates([
    join(home, '.melodysync', 'runtime', 'sessions', 'runs', organize.json.run.id, 'manifest.json'),
    join(home, '.config', 'melody-sync', 'chat-runs', organize.json.run.id, 'manifest.json'),
    join(home, '.melodysync', 'sessions', 'runs', organize.json.run.id, 'manifest.json'),
  ]);
  assert.match(
    organizerManifest.prompt,
    /Only writable API fields for this task are `name`, `group`, and `sidebarOrder`\./,
    'organizer prompt should spell out the writable session fields',
  );
  assert.match(
    organizerManifest.prompt,
    /"existingGroup": ""/,
    'organizer task payload should expose existingGroup as read-only snapshot context',
  );
  assert.match(
    organizerManifest.prompt,
    /"existingSidebarOrder": null/,
    'organizer task payload should expose existingSidebarOrder as read-only snapshot context',
  );
  assert.doesNotMatch(
    organizerManifest.prompt,
    /"currentGroup"|"currentSidebarOrder"/,
    'organizer task payload should not use the older current* field names',
  );

  const listed = await request(port, 'GET', '/api/sessions');
  assert.equal(listed.status, 200, 'session list should remain available after organizing');
  assert.equal((listed.json.sessions || []).length, 2, 'hidden organizer session should not appear in the normal list');

  const primaryEntry = listed.json.sessions.find((entry) => entry.id === primarySession.json.session.id);
  const quartzEntry = listed.json.sessions.find((entry) => entry.id === quartzSession.json.session.id);
  assert.equal(primaryEntry?.group, '收集箱', 'organizer should patch the default GTD inbox group');
  assert.equal(primaryEntry?.sidebarOrder, 1, 'organizer should patch the default inbox sidebar order');
  assert.equal(primaryEntry?.name, '整理会话工作流', 'organizer should be able to patch a clearer task name');
  assert.equal(quartzEntry?.group, '知识库内容', 'organizer should patch the knowledge-base group');
  assert.equal(quartzEntry?.sidebarOrder, 2, 'organizer should patch the Quartz sidebar order');

  const storedMeta = readJsonFromCandidates([
    join(home, '.melodysync', 'runtime', 'sessions', 'chat-sessions.json'),
    join(configDir, 'chat-sessions.json'),
    join(home, '.melodysync', 'sessions', 'chat-sessions.json'),
  ]);
  const hiddenOrganizer = storedMeta.find((entry) => entry && entry.internalRole === SESSION_LIST_ORGANIZER_INTERNAL_ROLE);
  assert.ok(hiddenOrganizer, 'organizer trigger should create a hidden internal session');
  assert.match(
    hiddenOrganizer.systemPrompt || '',
    /Only writable API fields for this task are `name`, `group`, and `sidebarOrder`\./,
    'hidden organizer session should persist the writable field guardrail',
  );

  console.log('test-http-session-list-organize: ok');
} finally {
  await stopServer(server);
  rmSync(home, { recursive: true, force: true });
}
