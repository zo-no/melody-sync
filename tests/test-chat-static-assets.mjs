#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const cookie = 'session_token=test-session';

function randomPort() {
  return 43000 + Math.floor(Math.random() * 10000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendOutput(buffer, chunk, limit = 8000) {
  const next = `${buffer}${chunk}`;
  return next.length <= limit ? next : next.slice(-limit);
}

function formatStartupOutput(stdout, stderr) {
  const sections = [];
  if (stderr.trim()) sections.push(`stderr:\n${stderr.trim()}`);
  if (stdout.trim()) sections.push(`stdout:\n${stdout.trim()}`);
  return sections.join('\n\n');
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
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Cookie: cookie,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...extraHeaders,
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, text: data });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function setupTempHome() {
  const home = mkdtempSync(join(tmpdir(), 'remotelab-chat-static-'));
  const configDir = join(home, '.config', 'remotelab');
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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => {
    stdout = appendOutput(stdout, chunk);
  });
  child.stderr?.on('data', (chunk) => {
    stderr = appendOutput(stderr, chunk);
  });

  try {
    await waitFor(async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        const exitLabel = child.signalCode ? `signal ${child.signalCode}` : `code ${child.exitCode}`;
        const output = formatStartupOutput(stdout, stderr);
        throw new Error(
          output
            ? `Server exited during startup with ${exitLabel}\n\n${output}`
            : `Server exited during startup with ${exitLabel}`,
        );
      }
      try {
        const res = await request(port, 'GET', '/login', null, { Cookie: '' });
        return res.status === 200;
      } catch {
        return false;
      }
    }, 'server startup');
  } catch (error) {
    const output = formatStartupOutput(stdout, stderr);
    if (!output || String(error.message).includes(output)) {
      throw error;
    }
    throw new Error(`${error.message}\n\n${output}`);
  }

  return { child };
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await waitFor(() => server.child.exitCode !== null, 'server shutdown');
}

async function main() {
  const { home } = setupTempHome();
  const sessionsFile = join(home, '.config', 'remotelab', 'auth-sessions.json');
  const port = randomPort();
  const server = await startServer({ home, port });

  try {
    const authMe = await request(port, 'GET', '/api/auth/me');
    assert.equal(authMe.status, 200, 'auth info endpoint should work for owner session');
    assert.equal(authMe.headers['set-cookie']?.length, 1, 'auth info should refresh a near-expiry auth cookie');
    assert.match(authMe.headers['set-cookie'][0], /SameSite=Lax/i, 'auth cookie should use SameSite=Lax for better PWA compatibility');
    assert.match(authMe.headers['set-cookie'][0], /Max-Age=86400/i, 'auth cookie should include an explicit Max-Age');
    const refreshedSessions = JSON.parse(readFileSync(sessionsFile, 'utf8'));
    assert.ok(
      refreshedSessions['test-session']?.expiry > Date.now() + 23 * 60 * 60 * 1000,
      'auth info should extend server-side session expiry as a sliding session',
    );

    const page = await request(port, 'GET', '/');
    assert.equal(page.status, 200, 'chat page should render for owner session');
    assert.match(page.text, /<meta name="color-scheme" content="light dark">/);
    assert.match(page.text, /<meta name="theme-color" content="#e7edf0" media="\(prefers-color-scheme: light\)">/);
    assert.match(page.text, /<meta name="theme-color" content="#1c2329" media="\(prefers-color-scheme: dark\)">/);
    const bootstrapMatch = page.text.match(/window\.__REMOTELAB_BOOTSTRAP__ = ([^;]+);/);
    assert.ok(bootstrapMatch, 'chat page should inline bootstrap payload');
    const bootstrap = JSON.parse(bootstrapMatch[1]);
    assert.deepEqual(bootstrap.auth, { role: 'owner' }, 'bootstrap payload should include owner auth');
    assert.deepEqual(
      bootstrap.workbench?.nodeKinds,
      ['main', 'branch', 'candidate', 'done'],
      'bootstrap payload should expose current workbench node kinds',
    );
    assert.equal(
      bootstrap.workbench?.nodeKindDefinitions?.find((definition) => definition.id === 'branch')?.label,
      '子任务',
      'bootstrap payload should expose canonical labeled node definitions',
    );
    assert.match(page.text, /<script src="\/chat\/core\/bootstrap\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/core\/bootstrap-session-catalog\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/session\/http-helpers\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/session\/http-list-state\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/session\/http\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/core\/layout-tooling\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/session\/tooling\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/core\/realtime\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/core\/realtime-render\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/session\/transcript-ui\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/session\/surface-ui\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/session-list\/model\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/session-list\/ui\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/session-list\/sidebar-ui\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/workbench\/node-contract\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/workbench\/node-effects\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/workbench\/node-settings-model\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/workbench\/task-map-plan\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/workbench\/task-map-model\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/workbench\/task-tracker-ui\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/workbench\/task-map-ui\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/workbench\/node-settings-ui\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/workbench\/task-list-ui\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/workbench\/quest-state\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/workbench\/branch-actions\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/workbench\/operation-record-ui\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/workbench-ui\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/session\/compose\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/core\/gestures\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/settings\/hooks\/model\.js(?:\?v=[^"]*)?"/);
    assert.match(page.text, /<script src="\/chat\/settings\/hooks\/ui\.js(?:\?v=[^"]*)?"/);
    assert.doesNotMatch(page.text, /<script src="\/chat\/voice-input\.js(?:\?v=[^"]*)?"/);

    assert.match(page.text, /<script src="\/chat\/core\/init\.js(?:\?v=[^"]*)?"/);
    assert.doesNotMatch(page.text, /id="appFilterSelect"/);
    assert.doesNotMatch(page.text, /id="sourceFilterSelect"/);
    assert.doesNotMatch(page.text, /id="sessionAppFilterSelect"/);
    assert.doesNotMatch(page.text, /id="userFilterSelect"/);
    assert.match(page.text, /id="sortSessionListBtn"/, 'chat page should keep the dedicated task-list organizing entry');
    assert.match(page.text, /https:\/\/github\.com\/zo-no\/melody-sync/, 'chat page footer should point at the real open-source repository');
    assert.doesNotMatch(page.text, /id="settingsAppsList"/);
    assert.doesNotMatch(page.text, /id="tabBoard"/);
    assert.doesNotMatch(page.text, /id="boardPanel"/);
    assert.doesNotMatch(page.text, /id="settingsUsersList"/);
    assert.doesNotMatch(page.text, /id="newUserNameInput"/);
    assert.doesNotMatch(page.text, /id="createUserBtn"/);
    assert.doesNotMatch(page.text, /id="newAppNameInput"/);
    assert.doesNotMatch(page.text, /id="newAppToolSelect"/);
    assert.doesNotMatch(page.text, /id="newAppWelcomeInput"/);
    assert.doesNotMatch(page.text, /id="newAppSystemPromptInput"/);
    assert.doesNotMatch(page.text, /id="createAppConfigBtn"/);
    assert.doesNotMatch(page.text, /id="voiceSettingsMount"/);
    assert.doesNotMatch(page.text, /id="voiceInputBtn"/);
    assert.doesNotMatch(page.text, /id="voiceFileInput"/);
    assert.match(page.text, /id="msgInput"[\s\S]*id="sendBtn"/, 'send button should render immediately after the composer textarea');
    assert.doesNotMatch(page.text, /id="voiceInputStatus"/);
    assert.doesNotMatch(page.text, /id="tabSettings"/);
    assert.doesNotMatch(page.text, /id="collapseBtn"/, 'desktop sidebar should no longer expose a collapse control');
    assert.doesNotMatch(page.text, /id="tabProgress"/);
    assert.doesNotMatch(page.text, /id="compactBtn"/);
    assert.doesNotMatch(page.text, /id="dropToolsBtn"/);
    assert.doesNotMatch(page.text, /id="saveTemplateBtn"/);
    assert.doesNotMatch(page.text, /id="sessionTemplateSelect"/);
    assert.doesNotMatch(page.text, /id="forkSessionBtn"/, 'chat page should not ship detached fork header controls');
    assert.doesNotMatch(page.text, /id="organizeSessionBtn"/, 'chat page should not ship detached organize header controls');
    assert.match(page.text, /id="taskMapRail"/, 'chat page should ship the dedicated middle-column task map rail');
    assert.match(page.text, /id="hooksSettingsBtn"/, 'chat page should ship the shared settings trigger in the sidebar header');
    assert.match(page.text, /id="settingsTabHooks"/, 'chat page should ship the hooks tab inside the shared settings overlay');
    assert.match(page.text, /id="settingsTabNodes"/, 'chat page should ship the node tab inside the shared settings overlay');
    assert.match(page.text, /id="settingsPanelNodes"/, 'chat page should ship the node settings panel mount inside the shared settings overlay');
    assert.match(page.text, /id="taskMapNodeSettingsBody"/, 'chat page should ship the node settings body mount inside the shared settings overlay');
    assert.doesNotMatch(page.text, /id="taskMapNodeSettingsBtn"/, 'chat page should no longer ship a separate map-rail node settings trigger');
    assert.doesNotMatch(page.text, /id="taskMapNodeSettingsOverlay"/, 'chat page should no longer ship a separate node settings overlay');
    assert.match(page.text, /id="questTaskList"/, 'chat page should ship the task-map mount');
    assert.match(page.text, /id="taskMapDrawerBtn"/, 'chat page should ship the mobile task-map drawer toggle');
    assert.match(page.text, /id="taskMapDrawerBackdrop"/, 'chat page should ship the mobile task-map drawer backdrop');
    assert.match(page.text, /id="questTrackerStatus"/, 'chat page should render the task-status mount inside the task bar');
    assert.match(page.text, /\/chat\/workbench\/node-contract\.js\?v=/, 'chat page should load the shared workbench node contract');
    assert.match(page.text, /\/chat\/workbench\/node-effects\.js\?v=/, 'chat page should load the shared workbench node effects before task-map projection');
    assert.match(page.text, /\/chat\/workbench\/task-map-plan\.js\?v=/, 'chat page should load the task-map plan overlay before the projection model');
    assert.match(page.text, /\/chat\/workbench\/task-map-model\.js\?v=/, 'chat page should load the task-map projection model before the workbench runtime');
    assert.match(page.text, /\/chat\/workbench\/node-contract\.js\?v=[^"]*"[\s\S]*?\/chat\/workbench\/node-effects\.js\?v=[^"]*"[\s\S]*?\/chat\/workbench\/node-settings-model\.js\?v=[^"]*"[\s\S]*?\/chat\/workbench\/task-map-plan\.js\?v=[^"]*"[\s\S]*?\/chat\/workbench\/task-map-model\.js\?v=/, 'chat page should load the node contract, node effects, node settings model, and task-map plan overlay before the task-map projection model');
    assert.match(page.text, /\/chat\/workbench\/task-map-model\.js\?v=[^"]*"[\s\S]*?\/chat\/workbench\/quest-state\.js\?v=[^"]*"[\s\S]*?\/chat\/workbench\/task-tracker-ui\.js\?v=[^"]*"[\s\S]*?\/chat\/workbench\/task-map-ui\.js\?v=[^"]*"[\s\S]*?\/chat\/workbench\/task-list-ui\.js\?v=[^"]*"[\s\S]*?\/chat\/workbench\/branch-actions\.js\?v=[^"]*"[\s\S]*?\/chat\/workbench\/operation-record-ui\.js\?v=[^"]*"[\s\S]*?\/chat\/workbench-ui\.js\?v=[^"]*"[\s\S]*?\/chat\/settings\/ui\.js\?v=[^"]*"[\s\S]*?\/chat\/settings\/hooks\/model\.js\?v=[^"]*"[\s\S]*?\/chat\/workbench\/node-settings-ui\.js\?v=[^"]*"[\s\S]*?\/chat\/settings\/hooks\/ui\.js\?v=/, 'chat page should load workbench helpers first, then the shared settings shell and tab content');
    assert.match(page.text, /<div class="app-shell">/, 'chat page should render inside a dedicated app shell');
    assert.match(page.text, /\/chat\/chat\.css\?v=/, 'chat page should fingerprint the split chat stylesheet');
    const chatStylesheet = await request(port, 'GET', '/chat/chat.css');
    assert.equal(chatStylesheet.status, 200, 'chat stylesheet should load');
    assert.equal(
      chatStylesheet.headers['cache-control'],
      'public, no-cache, max-age=0, must-revalidate',
      'chat stylesheet should use safe revalidation caching',
    );
    assert.ok(chatStylesheet.headers.etag, 'chat stylesheet should expose an ETag');
    assert.match(chatStylesheet.text, /@import url\("\/chat\/chat-base\.css"\);/);
    assert.match(chatStylesheet.text, /@import url\("\/chat\/chat-sidebar\.css"\);/);
    assert.match(chatStylesheet.text, /@import url\("\/chat\/chat-messages\.css"\);/);
    assert.match(chatStylesheet.text, /@import url\("\/chat\/chat-input\.css"\);/);
    assert.match(chatStylesheet.text, /@import url\("\/chat\/chat-responsive\.css"\);/);

    const chatBaseStylesheet = await request(port, 'GET', '/chat/chat-base.css');
    const chatSidebarStylesheet = await request(port, 'GET', '/chat/chat-sidebar.css');
    const chatMessagesStylesheet = await request(port, 'GET', '/chat/chat-messages.css');
    const chatInputStylesheet = await request(port, 'GET', '/chat/chat-input.css');
    const chatResponsiveStylesheet = await request(port, 'GET', '/chat/chat-responsive.css');
    const chatWorkbenchStylesheet = await request(port, 'GET', '/chat/chat-workbench.css');
    for (const stylesheet of [chatBaseStylesheet, chatSidebarStylesheet, chatMessagesStylesheet, chatInputStylesheet, chatResponsiveStylesheet]) {
      assert.equal(stylesheet.status, 200, 'split chat stylesheet should load');
      assert.equal(
        stylesheet.headers['cache-control'],
        'public, no-cache, max-age=0, must-revalidate',
        'split chat stylesheet should use safe revalidation caching',
      );
      assert.ok(stylesheet.headers.etag, 'split chat stylesheet should expose an ETag');
    }
    assert.equal(chatWorkbenchStylesheet.status, 200, 'workbench stylesheet should load');
    assert.equal(
      chatWorkbenchStylesheet.headers['cache-control'],
      'public, no-cache, max-age=0, must-revalidate',
      'workbench stylesheet should use safe revalidation caching',
    );
    assert.ok(chatWorkbenchStylesheet.headers.etag, 'workbench stylesheet should expose an ETag');
    const combinedChatStyles = [
      chatBaseStylesheet.text,
      chatSidebarStylesheet.text,
      chatMessagesStylesheet.text,
      chatInputStylesheet.text,
      chatResponsiveStylesheet.text,
    ].join('\n');
    assert.match(combinedChatStyles, /\.header-btn,\s*\.sidebar-tab,\s*\.sidebar-filter-select,\s*\.new-session-btn,\s*\.session-action-btn,\s*\.session-item,\s*\.folder-group-header,\s*\.archived-section-header\s*\{[\s\S]*?-webkit-tap-highlight-color:\s*transparent;/, 'sidebar interactions should suppress the mobile tap highlight flash');
    assert.match(combinedChatStyles, /--app-height:\s*100dvh/);
    assert.match(combinedChatStyles, /--keyboard-inset-height:\s*0px/);
    assert.match(combinedChatStyles, /--sidebar-width-expanded:\s*min\(80vw, calc\(100vw - 240px\)\);/);
    assert.match(combinedChatStyles, /\.app-shell\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\);/, 'app shell should reserve a fixed header row and a flexible body row');
    assert.match(combinedChatStyles, /\.app-container\s*\{[\s\S]*?min-height:\s*0;/);
    assert.match(combinedChatStyles, /\.chat-area\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\);[\s\S]*?min-height:\s*0;/, 'chat area should now host a single flexible task-manager body row');
    assert.match(combinedChatStyles, /\.task-manager-main-column\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto auto;[\s\S]*?overflow:\s*hidden;/, 'task-manager main column should model task bar, messages, queued panel, and composer as explicit rows');
    assert.match(combinedChatStyles, /\.task-manager-body\s*\{[\s\S]*?grid-template-areas:\s*"rail"[\s\S]*?"main";/, 'task-manager body should explicitly model the task map and the main task column');
    assert.match(combinedChatStyles, /@media \(min-width: 768px\)\s*\{[\s\S]*?grid-template-areas:\s*"main rail";/, 'desktop task manager should use a single PC-first workspace with the map as the right-side rail');
    assert.match(combinedChatStyles, /\.chat-area > \*\s*\{[\s\S]*?min-width:\s*0;/, 'chat-area grid children should be allowed to shrink horizontally instead of expanding the column');
    assert.match(combinedChatStyles, /\.messages\s*\{[\s\S]*?min-height:\s*0;/);
    assert.match(combinedChatStyles, /\.messages-inner\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/, 'message column should stay bound to the available chat width');
    assert.match(combinedChatStyles, /\.input-resize-handle\s*\{[\s\S]*?margin:\s*0 calc\(var\(--chat-gutter\) \* -1\) 8px;/, 'resize handle should mirror the current chat gutter so it does not create horizontal overflow on mobile');
    assert.doesNotMatch(combinedChatStyles, /\.sidebar-overlay\.collapsed/, 'desktop sidebar should no longer render a collapsed state');
    assert.match(combinedChatStyles, /\.modal-backdrop\s*\{[\s\S]*?padding-left:\s*calc\(var\(--sidebar-width\) \+ 24px\);/, 'desktop modals should offset against the fixed-width sidebar');
    assert.match(chatWorkbenchStylesheet.text, /\.operation-record-backdrop\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?backdrop-filter:\s*none;/, 'operation record backdrop should no longer dim or blur the main workspace');
    assert.match(chatWorkbenchStylesheet.text, /\.operation-record-rail\s*\{[\s\S]*?background:\s*var\(--bg\);[\s\S]*?backdrop-filter:\s*none;/, 'operation record rail should render as an opaque side panel');
    assert.match(combinedChatStyles, /body\.keyboard-open \.messages/);
    assert.match(combinedChatStyles, /body\.keyboard-open \.input-area/);
    assert.doesNotMatch(combinedChatStyles, /--app-top-offset/);
    assert.ok(!page.text.includes('/chat.js?v='), 'chat page should not pin the chat frontend to a versioned URL');
    assert.match(page.text, /\/marked\.min\.js\?v=/, 'chat page should fingerprint marked.min.js alongside the split chat assets');
    assert.match(page.text, /\/manifest\.json\?v=/, 'chat page should fingerprint the manifest URL so installed PWAs refresh policy changes');
    assert.match(page.text, /title="Attach files"/, 'chat page should advertise file uploads in the composer');
    assert.match(page.text, /accept="\*\/\*"/, 'chat page should allow arbitrary file selection');

    const manifest = await request(port, 'GET', '/manifest.json');
    assert.equal(manifest.status, 200, 'manifest should load');
    const manifestJson = JSON.parse(manifest.text);
    assert.equal(manifestJson.display, 'standalone', 'manifest should still advertise standalone install mode');
    assert.equal('orientation' in manifestJson, false, 'manifest should not force an orientation policy in the installed PWA shell');

    const loginPage = await request(port, 'GET', '/login', null, { Cookie: '' });
    assert.equal(loginPage.status, 200, 'login page should render without auth');
    assert.match(loginPage.text, /<meta name="color-scheme" content="light dark">/);
    assert.match(loginPage.text, /<meta name="theme-color" content="#f5f5f5" media="\(prefers-color-scheme: light\)">/);
    assert.match(loginPage.text, /<meta name="theme-color" content="#181818" media="\(prefers-color-scheme: dark\)">/);
    assert.match(loginPage.text, /@media \(prefers-color-scheme: dark\)/);

    const createdChat = await request(port, 'POST', '/api/sessions', {
      folder: home,
      tool: 'codex',
      name: 'Owner chat session',
    });
    assert.equal(createdChat.status, 201, 'owner chat session should be creatable over HTTP');
    const createdChatJson = JSON.parse(createdChat.text);

    const createdGithub = await request(port, 'POST', '/api/sessions', {
      folder: home,
      tool: 'codex',
      name: 'GitHub session',
      appId: 'github',
      appName: 'GitHub',
    });
    assert.equal(createdGithub.status, 201, 'GitHub-scoped session should be creatable over HTTP');
    const createdGithubJson = JSON.parse(createdGithub.text);

    const pinned = await request(port, 'PATCH', `/api/sessions/${createdChatJson.session.id}`, {
      pinned: true,
    });
    assert.equal(pinned.status, 200, 'session pinning should be available over HTTP');
    assert.match(pinned.text, /"pinned":true/);

    const allSessions = await request(port, 'GET', '/api/sessions');
    assert.equal(allSessions.status, 200, 'full session list should load');
    const allSessionsJson = JSON.parse(allSessions.text);
    assert.equal(
      allSessionsJson.sessions?.[0]?.id,
      createdChatJson.session.id,
      'pinned session should sort to the top of the session list',
    );
    assert.equal(
      allSessionsJson.sessions?.some((session) => session.id === createdGithubJson.session.id),
      true,
      'other sessions should remain visible after pinning',
    );

    const githubOnly = await request(port, 'GET', '/api/sessions?appId=github');
    assert.equal(githubOnly.status, 200, 'app-filtered session list should load');
    assert.match(githubOnly.text, /"appId":"github"/);
    assert.match(githubOnly.text, /"appName":"GitHub"/);
    assert.doesNotMatch(githubOnly.text, /"name":"Owner chat session"/);

    const splitAsset = await request(port, 'GET', '/chat/core/bootstrap.js');
    assert.equal(splitAsset.status, 200, 'split chat asset should load');
    assert.equal(
      splitAsset.headers['cache-control'],
      'public, no-cache, max-age=0, must-revalidate',
      'split asset should use safe revalidation caching',
    );
    assert.ok(splitAsset.headers.etag, 'split asset should expose an ETag');
    assert.match(splitAsset.text, /const bootstrapStore = window\.MelodySyncBootstrap;/);
    assert.match(splitAsset.text, /const buildInfo = bootstrapStore\?\.getBuildInfo\?\.\(\) \|\| \{\};/);
    assert.doesNotMatch(splitAsset.text, /forkSessionBtn|organizeSessionBtn/, 'bootstrap should not look up detached header controls');

    const sessionHttpHelpersAsset = await request(port, 'GET', '/chat/session/http-helpers.js');
    assert.equal(sessionHttpHelpersAsset.status, 200, 'session http helpers asset should load');
    assert.match(sessionHttpHelpersAsset.text, /function enhanceRenderedContentLinks\(/);
    assert.match(sessionHttpHelpersAsset.text, /const SESSION_LIST_URL = "\/api\/sessions";/);

    const sessionHttpListStateAsset = await request(port, 'GET', '/chat/session/http-list-state.js');
    assert.equal(sessionHttpListStateAsset.status, 200, 'session http list state asset should load');
    assert.match(sessionHttpListStateAsset.text, /function applySessionListState\(/);
    assert.match(sessionHttpListStateAsset.text, /function applyArchivedSessionListState\(/);

    const sessionHttpAsset = await request(port, 'GET', '/chat/session/http.js');
    assert.equal(sessionHttpAsset.status, 200, 'session http asset should load');
    const bootstrapCatalogAsset = await request(port, 'GET', '/chat/core/bootstrap-session-catalog.js');
    assert.equal(bootstrapCatalogAsset.status, 200, 'bootstrap session catalog asset should load');
    assert.match(bootstrapCatalogAsset.text, /function getEffectiveSessionAppId\(/);
    assert.match(bootstrapCatalogAsset.text, /function sortSessionsInPlace\(/);

    if (/getEffectiveSessionAppId\(/.test(sessionHttpAsset.text)) {
      assert.match(
        bootstrapCatalogAsset.text,
        /function getEffectiveSessionAppId\(/,
        'bootstrap session catalog asset should define the effective app helper used by session-http',
      );
    }

    const versionedSplitAsset = await request(port, 'GET', '/chat/core/bootstrap.js?v=test-build');
    assert.equal(versionedSplitAsset.status, 200, 'versioned split chat asset should load');
    assert.equal(
      versionedSplitAsset.headers['cache-control'],
      'public, max-age=31536000, immutable',
      'versioned split assets should be immutable cache hits',
    );

    const versionedBootstrapCatalogAsset = await request(port, 'GET', '/chat/core/bootstrap-session-catalog.js?v=test-build');
    assert.equal(versionedBootstrapCatalogAsset.status, 200, 'versioned bootstrap session catalog asset should load');
    assert.equal(
      versionedBootstrapCatalogAsset.headers['cache-control'],
      'public, max-age=31536000, immutable',
      'versioned bootstrap session catalog asset should be immutable cache hits',
    );

    const versionedSessionHttpHelpersAsset = await request(port, 'GET', '/chat/session/http-helpers.js?v=test-build');
    assert.equal(versionedSessionHttpHelpersAsset.status, 200, 'versioned session http helpers asset should load');
    assert.equal(
      versionedSessionHttpHelpersAsset.headers['cache-control'],
      'public, max-age=31536000, immutable',
      'versioned session http helpers asset should be immutable cache hits',
    );

    const versionedSessionHttpListStateAsset = await request(port, 'GET', '/chat/session/http-list-state.js?v=test-build');
    assert.equal(versionedSessionHttpListStateAsset.status, 200, 'versioned session http list state asset should load');
    assert.equal(
      versionedSessionHttpListStateAsset.headers['cache-control'],
      'public, max-age=31536000, immutable',
      'versioned session http list state asset should be immutable cache hits',
    );

    const versionedLayoutToolingAsset = await request(port, 'GET', '/chat/core/layout-tooling.js?v=test-build');
    assert.equal(versionedLayoutToolingAsset.status, 200, 'versioned layout tooling asset should load');
    assert.equal(
      versionedLayoutToolingAsset.headers['cache-control'],
      'public, max-age=31536000, immutable',
      'versioned layout tooling asset should be immutable cache hits',
    );

    const versionedRealtimeRenderAsset = await request(port, 'GET', '/chat/core/realtime-render.js?v=test-build');
    assert.equal(versionedRealtimeRenderAsset.status, 200, 'versioned realtime render asset should load');
    assert.equal(
      versionedRealtimeRenderAsset.headers['cache-control'],
      'public, max-age=31536000, immutable',
      'versioned realtime render asset should be immutable cache hits',
    );

    const versionedChatStylesheet = await request(port, 'GET', '/chat/chat.css?v=test-build');
    assert.equal(versionedChatStylesheet.status, 200, 'versioned chat stylesheet should load');
    assert.equal(
      versionedChatStylesheet.headers['cache-control'],
      'public, max-age=31536000, immutable',
      'versioned chat stylesheet should be immutable cache hits',
    );

    const versionedChatBaseStylesheet = await request(port, 'GET', '/chat/chat-base.css?v=test-build');
    assert.equal(versionedChatBaseStylesheet.status, 200, 'versioned split chat stylesheet should load');
    assert.equal(
      versionedChatBaseStylesheet.headers['cache-control'],
      'public, max-age=31536000, immutable',
      'versioned split chat stylesheet should be immutable cache hits',
    );

    const stateModelAsset = await request(port, 'GET', '/chat/session/state-model.js');
    assert.equal(stateModelAsset.status, 200, 'session state model asset should load');
    assert.equal(
      stateModelAsset.headers['cache-control'],
      'public, no-cache, max-age=0, must-revalidate',
      'session state model should use safe revalidation caching',
    );
    assert.ok(stateModelAsset.headers.etag, 'session state model asset should expose an ETag');
    assert.match(stateModelAsset.text, /MelodySyncSessionStateModel/);

    const sessionListOrderContractAsset = await request(port, 'GET', '/chat/session-list/order-contract.js');
    assert.equal(sessionListOrderContractAsset.status, 200, 'session list order contract asset should load');
    assert.match(sessionListOrderContractAsset.text, /SESSION_LIST_ORDER_SOURCE_DEFINITIONS/);

    const layoutToolingAsset = await request(port, 'GET', '/chat/core/layout-tooling.js');
    assert.equal(layoutToolingAsset.status, 200, 'layout tooling asset should load');
    assert.match(layoutToolingAsset.text, /document\.documentElement\.style\.setProperty\("--app-height"/);
    assert.match(layoutToolingAsset.text, /document\.documentElement\.style\.setProperty\("--keyboard-inset-height"/);
    assert.match(layoutToolingAsset.text, /function requestLayoutPass\(/);
    assert.match(layoutToolingAsset.text, /window\.MelodySyncLayout = \{/);
    assert.match(layoutToolingAsset.text, /window\.visualViewport\?\.addEventListener\("resize", \(\) => requestLayoutPass\("visual-viewport-resize"\)\)/);
    assert.doesNotMatch(layoutToolingAsset.text, /window\.visualViewport\?\.addEventListener\("scroll"/);
    assert.match(layoutToolingAsset.text, /function focusComposer\(/);

    const toolingAsset = await request(port, 'GET', '/chat/session/tooling.js');
    assert.equal(toolingAsset.status, 200, 'tooling asset should load');
    assert.match(toolingAsset.text, /const modelResponseCache = new Map\(\);/);
    assert.match(toolingAsset.text, /async function fetchModelResponse\(/);
    assert.doesNotMatch(toolingAsset.text, /syncForkButton|syncOrganizeSessionButton|forkCurrentSession|organizeCurrentSession/, 'tooling asset should not ship detached header-action handlers');

    const realtimeRenderAsset = await request(port, 'GET', '/chat/core/realtime-render.js');
    assert.equal(realtimeRenderAsset.status, 200, 'realtime render asset should load');
    assert.match(realtimeRenderAsset.text, /function renderEvent\(/);
    assert.match(realtimeRenderAsset.text, /async function hydrateLazyNodes\(/);

    const uiAsset = await request(port, 'GET', '/chat/session/transcript-ui.js');
    assert.equal(uiAsset.status, 200, 'ui asset should load');
    assert.match(uiAsset.text, /\/api\/media\//, 'ui asset should load persisted media attachments from the media route');

    const sessionSurfaceUiAsset = await request(port, 'GET', '/chat/session/surface-ui.js');
    assert.equal(sessionSurfaceUiAsset.status, 200, 'session surface ui asset should load');
    assert.match(sessionSurfaceUiAsset.text, /function createActiveSessionItem\(/);
    assert.match(sessionSurfaceUiAsset.text, /function buildSessionMetaParts\(/);
    assert.doesNotMatch(sessionSurfaceUiAsset.text, /function createTaskClusterNodes\(/, 'session surface ui should no longer embed sidebar task-tree rendering');

    const sessionListModelAsset = await request(port, 'GET', '/chat/session-list/model.js');
    assert.equal(sessionListModelAsset.status, 200, 'session list model asset should load');
    assert.match(sessionListModelAsset.text, /MelodySyncSessionListModel/);
    assert.match(sessionListModelAsset.text, /function getSessionGroupInfo\(/);

    const sessionListContractAsset = await request(port, 'GET', '/chat/session-list/contract.js');
    assert.equal(sessionListContractAsset.status, 200, 'session list contract asset should load');
    assert.match(sessionListContractAsset.text, /MelodySyncSessionListContract/);
    assert.match(sessionListContractAsset.text, /SESSION_LIST_AI_MUTABLE_FIELD_DEFINITIONS/);

    const sessionListUiAsset = await request(port, 'GET', '/chat/session-list/ui.js');
    assert.equal(sessionListUiAsset.status, 200, 'session list ui asset should load');
    assert.match(sessionListUiAsset.text, /function renderSessionList\(/);
    assert.match(sessionListUiAsset.text, /function attachSession\(/);
    assert.match(sessionListUiAsset.text, /focusComposer\(\{ preventScroll: true \}\)/);
    assert.doesNotMatch(sessionListUiAsset.text, /getSidebarTaskClusters/, 'session list ui should render from stable session list data instead of workbench task clusters');

    const hooksModelAsset = await request(port, 'GET', '/chat/settings/hooks/model.js');
    assert.equal(hooksModelAsset.status, 200, 'hooks settings model asset should load');
    assert.match(hooksModelAsset.text, /MelodySyncHooksSettingsModel/);
    assert.match(hooksModelAsset.text, /buildPhaseSections/);

    const hooksUiAsset = await request(port, 'GET', '/chat/settings/hooks/ui.js');
    assert.equal(hooksUiAsset.status, 200, 'hooks ui asset should load');
    assert.match(hooksUiAsset.text, /MelodySyncHooksSettingsModel/);
    assert.match(hooksUiAsset.text, /MelodySyncSettingsPanel/);
    assert.match(hooksUiAsset.text, /document\.getElementById\('hooksPanelBody'\)/);
    assert.match(hooksUiAsset.text, /hooks-phase-list/);
    assert.match(hooksUiAsset.text, /hooks-flow-chart/);

    const settingsUiAsset = await request(port, 'GET', '/chat/settings/ui.js');
    assert.equal(settingsUiAsset.status, 200, 'shared settings ui asset should load');
    assert.match(settingsUiAsset.text, /MelodySyncSettingsPanel/);
    assert.match(settingsUiAsset.text, /data-settings-tab/);

    const nodeContractAsset = await request(port, 'GET', '/chat/workbench/node-contract.js');
    assert.equal(nodeContractAsset.status, 200, 'workbench node contract asset should load');
    assert.match(nodeContractAsset.text, /MelodySyncWorkbenchNodeContract/);
    assert.match(nodeContractAsset.text, /NODE_KIND_DEFINITIONS/);
    assert.match(nodeContractAsset.text, /readBootstrapNodeContract/, 'node contract should read bootstrap-backed node definitions');

    const nodeEffectsAsset = await request(port, 'GET', '/chat/workbench/node-effects.js');
    assert.equal(nodeEffectsAsset.status, 200, 'workbench node effects asset should load');
    assert.match(nodeEffectsAsset.text, /MelodySyncWorkbenchNodeEffects/);
    assert.match(nodeEffectsAsset.text, /function getNodeKindEffect/);
    assert.match(nodeEffectsAsset.text, /function buildQuestNodeCounts/);

    const nodeSettingsModelAsset = await request(port, 'GET', '/chat/workbench/node-settings-model.js');
    assert.equal(nodeSettingsModelAsset.status, 200, 'workbench node settings model asset should load');
    assert.match(nodeSettingsModelAsset.text, /MelodySyncTaskMapNodeSettingsModel/);
    assert.match(nodeSettingsModelAsset.text, /describeNodeKind/);

    const taskMapPlanAsset = await request(port, 'GET', '/chat/workbench/task-map-plan.js');
    assert.equal(taskMapPlanAsset.status, 200, 'task map plan asset should load');
    assert.match(taskMapPlanAsset.text, /MelodySyncTaskMapPlan/);
    assert.match(taskMapPlanAsset.text, /function applyTaskMapPlansToProjection/);

    const taskMapModelAsset = await request(port, 'GET', '/chat/workbench/task-map-model.js');
    assert.equal(taskMapModelAsset.status, 200, 'task map model asset should load');
    assert.match(taskMapModelAsset.text, /MelodySyncTaskMapModel/);
    assert.match(taskMapModelAsset.text, /function buildTaskMapProjection\(/);

    const nodeSettingsUiAsset = await request(port, 'GET', '/chat/workbench/node-settings-ui.js');
    assert.equal(nodeSettingsUiAsset.status, 200, 'workbench node settings ui asset should load');
    assert.match(nodeSettingsUiAsset.text, /MelodySyncTaskMapNodeSettingsUi/);
    assert.match(nodeSettingsUiAsset.text, /MelodySyncSettingsPanel/);
    assert.match(nodeSettingsUiAsset.text, /自定义节点/);

    const nodeDefinitionsApi = await request(port, 'GET', '/api/workbench/node-definitions');
    assert.equal(nodeDefinitionsApi.status, 200, 'workbench node definitions api should expose current node metadata');
    const nodeDefinitionsJson = JSON.parse(nodeDefinitionsApi.text);
    assert.deepEqual(
      nodeDefinitionsJson.nodeKinds,
      ['main', 'branch', 'candidate', 'done'],
      'workbench node definitions api should expose the current node kinds',
    );
    assert.deepEqual(
      nodeDefinitionsJson.nodeLanes,
      ['main', 'branch', 'side'],
      'workbench node definitions api should expose the current node lanes',
    );
    assert.deepEqual(
      nodeDefinitionsJson.nodeRoles,
      ['state', 'action', 'summary'],
      'workbench node definitions api should expose the current node roles',
    );
    assert.deepEqual(
      nodeDefinitionsJson.nodeMergePolicies,
      ['replace-latest', 'append'],
      'workbench node definitions api should expose the current node merge policies',
    );
    assert.deepEqual(
      nodeDefinitionsJson.nodeInteractions,
      ['open-session', 'create-branch', 'none'],
      'workbench node definitions api should expose the current node interactions',
    );
    assert.deepEqual(
      nodeDefinitionsJson.nodeEdgeTypes,
      ['structural', 'suggestion', 'completion', 'merge'],
      'workbench node definitions api should expose the current node edge types',
    );
    assert.deepEqual(
      nodeDefinitionsJson.nodeLayoutVariants,
      ['root', 'default', 'compact'],
      'workbench node definitions api should expose the current node layout variants',
    );
    assert.equal(
      nodeDefinitionsJson.nodeKindDefinitions?.find((definition) => definition.id === 'candidate')?.role,
      'action',
      'workbench node definitions api should expose canonical node-kind metadata',
    );
    assert.equal(
      nodeDefinitionsJson.nodeKindDefinitions?.find((definition) => definition.id === 'candidate')?.composition?.defaultInteraction,
      'create-branch',
      'workbench node definitions api should expose composition rules for builtin kinds',
    );
    assert.equal(
      nodeDefinitionsJson.settings?.supportsCustomNodeKinds,
      true,
      'workbench node definitions api should describe custom-node support',
    );

    const createdNodeDefinition = await request(port, 'POST', '/api/workbench/node-definitions', {
      id: 'review-note',
      label: '复盘节点',
      description: '用于阶段复盘。',
      lane: 'side',
      role: 'summary',
      mergePolicy: 'append',
    });
    assert.equal(createdNodeDefinition.status, 201, 'workbench node definitions api should create custom node kinds');
    const createdNodeJson = JSON.parse(createdNodeDefinition.text);
    assert.equal(
      createdNodeJson.nodeKindDefinitions?.find((definition) => definition.id === 'review-note')?.label,
      '复盘节点',
      'created custom node kinds should appear in the canonical payload',
    );

    const patchedNodeDefinition = await request(port, 'PATCH', '/api/workbench/node-definitions/review-note', {
      label: '阶段复盘',
      description: '用于阶段性复盘。',
      lane: 'branch',
      role: 'action',
      mergePolicy: 'replace-latest',
    });
    assert.equal(patchedNodeDefinition.status, 200, 'workbench node definitions api should update custom node kinds');
    const patchedNodeJson = JSON.parse(patchedNodeDefinition.text);
    assert.equal(
      patchedNodeJson.nodeKindDefinitions?.find((definition) => definition.id === 'review-note')?.role,
      'action',
      'updated custom node kinds should keep the edited role',
    );

    const deletedNodeDefinition = await request(port, 'DELETE', '/api/workbench/node-definitions/review-note');
    assert.equal(deletedNodeDefinition.status, 200, 'workbench node definitions api should delete custom node kinds');
    const deletedNodeJson = JSON.parse(deletedNodeDefinition.text);
    assert.equal(
      deletedNodeJson.nodeKindDefinitions?.some((definition) => definition.id === 'review-note'),
      false,
      'deleted custom node kinds should be removed from the canonical payload',
    );

    const operationRecordUiAsset = await request(port, 'GET', '/chat/workbench/operation-record-ui.js');
    assert.equal(operationRecordUiAsset.status, 200, 'operation record ui asset should load');
    assert.match(operationRecordUiAsset.text, /MelodySyncOperationRecordUi/);
    assert.match(operationRecordUiAsset.text, /createController/);

    const taskTrackerUiAsset = await request(port, 'GET', '/chat/workbench/task-tracker-ui.js');
    assert.equal(taskTrackerUiAsset.status, 200, 'task tracker ui asset should load');
    assert.match(taskTrackerUiAsset.text, /MelodySyncTaskTrackerUi/);
    assert.match(taskTrackerUiAsset.text, /createTrackerRenderer/);

    const taskMapUiAsset = await request(port, 'GET', '/chat/workbench/task-map-ui.js');
    assert.equal(taskMapUiAsset.status, 200, 'task map ui asset should load');
    assert.match(taskMapUiAsset.text, /MelodySyncTaskMapUi/);
    assert.match(taskMapUiAsset.text, /createRenderer/);

    const questStateAsset = await request(port, 'GET', '/chat/workbench/quest-state.js');
    assert.equal(questStateAsset.status, 200, 'quest state asset should load');
    assert.match(questStateAsset.text, /MelodySyncQuestState/);
    assert.match(questStateAsset.text, /createSelector/);

    const taskListUiAsset = await request(port, 'GET', '/chat/workbench/task-list-ui.js');
    assert.equal(taskListUiAsset.status, 200, 'task list ui asset should load');
    assert.match(taskListUiAsset.text, /MelodySyncTaskListUi/);
    assert.match(taskListUiAsset.text, /createController/);

    const branchActionsAsset = await request(port, 'GET', '/chat/workbench/branch-actions.js');
    assert.equal(branchActionsAsset.status, 200, 'branch actions asset should load');
    assert.match(branchActionsAsset.text, /MelodySyncBranchActions/);
    assert.match(branchActionsAsset.text, /createController/);

    const hooksApi = await request(port, 'GET', '/api/hooks');
    assert.equal(hooksApi.status, 200, 'hooks api should list registered hooks');
    const hooksApiJson = JSON.parse(hooksApi.text);
    assert.deepEqual(
      hooksApiJson.events,
      [
        'instance.first_boot',
        'instance.startup',
        'instance.resume',
        'session.created',
        'session.first_user_message',
        'run.started',
        'run.completed',
        'run.failed',
        'branch.suggested',
        'branch.opened',
        'branch.merged',
      ],
      'hooks api should expose the supported lifecycle events',
    );
    assert.deepEqual(
      hooksApiJson.eventDefinitions?.map((definition) => definition.id),
      [
        'instance.first_boot',
        'instance.startup',
        'instance.resume',
        'session.created',
        'session.first_user_message',
        'run.started',
        'run.completed',
        'run.failed',
        'branch.suggested',
        'branch.opened',
        'branch.merged',
      ],
      'hooks api should expose the canonical lifecycle event definitions',
    );
    assert.deepEqual(
      hooksApiJson.phaseOrder,
      ['startup', 'entry', 'execution', 'closeout', 'branch_followup'],
      'hooks api should expose the canonical lifecycle phase order',
    );
    assert.deepEqual(
      hooksApiJson.phaseDefinitions?.map((definition) => definition.id),
      ['startup', 'entry', 'execution', 'closeout', 'branch_followup'],
      'hooks api should expose lifecycle phase definitions for the settings panel',
    );
    assert.deepEqual(
      hooksApiJson.scopeOrder,
      ['instance', 'session', 'run', 'branch'],
      'hooks api should expose the canonical lifecycle scope order',
    );
    assert.deepEqual(
      hooksApiJson.scopeDefinitions?.map((definition) => definition.id),
      ['instance', 'session', 'run', 'branch'],
      'hooks api should expose lifecycle scope definitions for the settings panel',
    );
    assert.equal(hooksApiJson.settings?.persistence, 'file');
    assert.match(hooksApiJson.settings?.storagePath || '', /hooks\.json$/);
    assert.deepEqual(
      hooksApiJson.layerOrder,
      ['boot', 'lifecycle', 'delivery', 'other'],
      'hooks api should expose the canonical hook layer order',
    );
    assert.deepEqual(
      hooksApiJson.layerDefinitions?.map((definition) => definition.id),
      ['boot', 'lifecycle', 'delivery', 'other'],
      'hooks api should expose hook layer definitions for the settings UI',
    );
    assert.deepEqual(
      hooksApiJson.taskMapPlanPolicyOrder,
      ['none', 'augment-default', 'replace-default'],
      'hooks api should expose the canonical task-map plan policy order',
    );
    assert.deepEqual(
      hooksApiJson.taskMapPlanPolicyDefinitions?.map((definition) => definition.id),
      ['none', 'augment-default', 'replace-default'],
      'hooks api should expose task-map plan policy definitions for architecture-aware clients',
    );
    assert.deepEqual(
      hooksApiJson.uiTargetDefinitions?.map((definition) => definition.id),
      [
        'session_stream',
        'task_status_strip',
        'task_action_panel',
        'task_map',
        'task_list_rows',
        'task_list_badges',
        'composer_assist',
        'workspace_notices',
        'settings_panels',
      ],
      'hooks api should expose the full UI surface contract for the settings panel',
    );
    assert.equal(
      hooksApiJson.eventDefinitions?.find((definition) => definition.id === 'run.completed')?.label,
      '执行完成',
    );
    assert.equal(
      hooksApiJson.eventDefinitions?.find((definition) => definition.id === 'run.completed')?.phase,
      'closeout',
    );
    assert.equal(
      hooksApiJson.eventDefinitions?.find((definition) => definition.id === 'run.started')?.phase,
      'execution',
    );
    assert.equal(
      hooksApiJson.eventDefinitions?.find((definition) => definition.id === 'run.completed')?.scope,
      'run',
    );
    assert.equal(hooksApiJson.hooks.find((hook) => hook.id === 'builtin.first-boot-memory')?.scope, 'instance');
    assert.equal(hooksApiJson.hooks.find((hook) => hook.id === 'builtin.first-boot-memory')?.phase, 'startup');
    assert.equal(hooksApiJson.hooks.find((hook) => hook.id === 'builtin.push-notification')?.scope, 'run');
    assert.equal(hooksApiJson.hooks.find((hook) => hook.id === 'builtin.push-notification')?.phase, 'closeout');
    assert.equal(hooksApiJson.hooks.find((hook) => hook.id === 'builtin.branch-candidates')?.scope, 'branch');
    assert.equal(hooksApiJson.hooks.find((hook) => hook.id === 'builtin.branch-candidates')?.phase, 'closeout');
    assert.equal(hooksApiJson.hooks.find((hook) => hook.id === 'builtin.first-boot-memory')?.layer, 'boot');
    assert.equal(hooksApiJson.hooks.find((hook) => hook.id === 'builtin.first-boot-memory')?.taskMapPlanPolicy, 'none');
    assert.equal(hooksApiJson.hooks.find((hook) => hook.id === 'builtin.first-boot-memory')?.producesTaskMapPlan, false);
    assert.equal(hooksApiJson.hooks.find((hook) => hook.id === 'builtin.push-notification')?.layer, 'delivery');
    assert.equal(hooksApiJson.hooks.find((hook) => hook.id === 'builtin.branch-candidates')?.layer, 'lifecycle');
    assert.equal(hooksApiJson.hooks.find((hook) => hook.id === 'builtin.branch-candidates')?.taskMapPlanPolicy, 'augment-default');
    assert.equal(hooksApiJson.hooks.find((hook) => hook.id === 'builtin.branch-candidates')?.producesTaskMapPlan, true);
    const hookIds = hooksApiJson.hooks.map((hook) => hook.id);
    for (const expectedHookId of [
      'builtin.first-boot-memory',
      'builtin.resume-completion-targets',
      'builtin.push-notification',
      'builtin.email-completion',
      'builtin.branch-candidates',
      'builtin.session-naming',
    ]) {
      assert.ok(
        hookIds.includes(expectedHookId),
        `hooks api should expose ${expectedHookId} for the settings panel`,
      );
    }

    const sidebarUiAsset = await request(port, 'GET', '/chat/session-list/sidebar-ui.js');
    assert.equal(sidebarUiAsset.status, 200, 'sidebar ui asset should load');
    assert.match(sidebarUiAsset.text, /function openSidebar\(/);
    assert.match(sidebarUiAsset.text, /function createNewSessionShortcut\(/);
    assert.match(sidebarUiAsset.text, /requestLayoutPass\("composer-images"\)/);

    const legacySettingsUiAsset = await request(port, 'GET', '/chat/settings-ui.js');
    assert.equal(legacySettingsUiAsset.status, 404, 'removed settings ui asset should no longer be served');

    const composeAsset = await request(port, 'GET', '/chat/session/compose.js');
    assert.equal(composeAsset.status, 200, 'compose asset should load');
    assert.match(composeAsset.text, /focusComposer\(\{ force: true, preventScroll: true \}\)/);
    assert.match(composeAsset.text, /window\.MelodySyncLayout\?\.subscribe/);

    const voiceInputAsset = await request(port, 'GET', '/chat/voice-input.js');
    assert.equal(voiceInputAsset.status, 404, 'removed voice input asset should no longer be served');

    const initAsset = await request(port, 'GET', '/chat/core/init.js');
    assert.equal(initAsset.status, 200, 'init asset should load');
    assert.match(initAsset.text, /typeof getBootstrapAuthInfo === "function"/);
    assert.match(initAsset.text, /loadInlineTools\(\{ skipModelLoad: true \}\)/);
    assert.match(initAsset.text, /bootstrapViaHttp\(\{ deferOwnerRestore: true \}\)/);

    const tokenLogin = await request(
      port,
      'GET',
      '/?token=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      null,
      { Cookie: '' },
    );
    assert.equal(tokenLogin.status, 302, 'token login should redirect into the app');
    assert.equal(tokenLogin.headers.location, '/', 'token login should land on the root app');
    assert.equal(tokenLogin.headers['set-cookie']?.length, 1, 'token login should issue a session cookie');
    assert.match(tokenLogin.headers['set-cookie'][0], /SameSite=Lax/i, 'token login cookie should use SameSite=Lax');
    assert.match(tokenLogin.headers['set-cookie'][0], /Max-Age=86400/i, 'token login cookie should include Max-Age');

    const splitAsset304 = await request(port, 'GET', '/chat/core/bootstrap.js', null, {
      'If-None-Match': splitAsset.headers.etag,
    });
    assert.equal(splitAsset304.status, 304, 'split asset should support conditional GETs');
    assert.equal(splitAsset304.text, '', '304 response should not include a body');

    const versionedSettingsUiAsset = await request(port, 'GET', '/chat/settings-ui.js?v=test-build');
    assert.equal(versionedSettingsUiAsset.status, 404, 'removed versioned settings ui asset should no longer be served');

    const versionedSessionSurfaceUiAsset = await request(port, 'GET', '/chat/session/surface-ui.js?v=test-build');
    assert.equal(versionedSessionSurfaceUiAsset.status, 200, 'versioned session surface ui asset should load');
    assert.equal(
      versionedSessionSurfaceUiAsset.headers['cache-control'],
      'public, max-age=31536000, immutable',
      'versioned session surface ui asset should be immutable cache hits',
    );

    const loader = await request(port, 'GET', '/chat.js');
    assert.equal(loader.status, 200, 'compatibility loader should still exist');
    assert.ok(loader.headers.etag, 'compatibility loader should expose an ETag');

    const loader304 = await request(port, 'GET', '/chat.js', null, {
      'If-None-Match': loader.headers.etag,
    });
    assert.equal(loader304.status, 304, 'loader should also support conditional GETs');
  } finally {
    await stopServer(server);
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
