#!/usr/bin/env node
import assert from 'assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-delete-permanent-'));

process.env.HOME = tempHome;
delete process.env.MELODYSYNC_CONFIG_DIR;
delete process.env.MELODYSYNC_MEMORY_DIR;
delete process.env.MELODYSYNC_INSTANCE_ROOT;
delete process.env.MELODYSYNC_OBSIDIAN_VAULT_DIR;
delete process.env.MELODYSYNC_OBSIDIAN_PATH;

const configDir = join(tempHome, '.config', 'melody-sync');
const vaultRoot = join(tempHome, 'vault');
const appRoot = join(vaultRoot, '00-🤖agent');
mkdirSync(configDir, { recursive: true });
mkdirSync(appRoot, { recursive: true });
writeFileSync(
  join(configDir, 'general-settings.json'),
  JSON.stringify({ appRoot }, null, 2),
  'utf8',
);

try {
  const config = await import(pathToFileURL(join(repoRoot, 'lib', 'config.mjs')).href);
  const sessionManager = await import(pathToFileURL(join(repoRoot, 'backend', 'session-manager.mjs')).href);
  const historyStore = await import(pathToFileURL(join(repoRoot, 'backend', 'history.mjs')).href);
  const normalizer = await import(pathToFileURL(join(repoRoot, 'backend', 'normalizer.mjs')).href);
  const runs = await import(pathToFileURL(join(repoRoot, 'backend', 'runs.mjs')).href);

  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const noteDir = join(vaultRoot, '02-📓journal', '04-📂日记', year);
  const notePath = join(noteDir, `${year}_${month}_${day}.md`);
  mkdirSync(noteDir, { recursive: true });
  writeFileSync(
    notePath,
    [
      '---',
      'type: journal',
      'agent_writable: section',
      '---',
      '',
      '## 当日事实',
      '',
      '## Agent Notes',
      '',
    ].join('\n'),
    'utf8',
  );

  const {
    CHAT_FILE_ASSETS_DIR,
    CHAT_FILE_ASSET_CACHE_DIR,
    CHAT_IMAGES_DIR,
  } = config;
  const {
    createSession,
    deleteSessionPermanently,
    killAll,
    listSessions,
    setSessionArchived,
    updateSessionTaskCard,
  } = sessionManager;
  const { appendEvent } = historyStore;
  const { fileChangeEvent, messageEvent } = normalizer;
  const { createRun, runDir, updateRun } = runs;

  const workspaceDir = join(tempHome, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(CHAT_IMAGES_DIR, { recursive: true });
  mkdirSync(CHAT_FILE_ASSETS_DIR, { recursive: true });
  mkdirSync(CHAT_FILE_ASSET_CACHE_DIR, { recursive: true });

  const rootSession = await createSession(workspaceDir, 'codex', '存储清理');
  const childSession = await createSession(workspaceDir, 'codex', '删除交互', {
    sourceContext: { parentSessionId: rootSession.id },
  });

  await updateSessionTaskCard(rootSession.id, {
    goal: '定位存储膨胀来源',
    knownConclusions: [
      '已定位 history 碎文件问题',
      '删除任务时先写日记再清理。',
    ],
  });

  const imagePath = join(CHAT_IMAGES_DIR, 'session-root-evidence.txt');
  writeFileSync(imagePath, 'attached evidence', 'utf8');

  const assetId = 'fasset_aaaaaaaaaaaaaaaaaaaaaaaa';
  const cachedAssetPath = join(CHAT_FILE_ASSET_CACHE_DIR, `${assetId}.txt`);
  writeFileSync(cachedAssetPath, 'cached attachment', 'utf8');
  writeFileSync(
    join(CHAT_FILE_ASSETS_DIR, `${assetId}.json`),
    JSON.stringify({
      id: assetId,
      sessionId: rootSession.id,
      status: 'ready',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      createdBy: 'owner',
      originalName: 'report.txt',
      mimeType: 'text/plain',
      localizedPath: cachedAssetPath,
      localizedAt: now.toISOString(),
      storage: { objectKey: 'tmp/report.txt' },
    }, null, 2),
    'utf8',
  );

  const runAssetId = 'fasset_bbbbbbbbbbbbbbbbbbbbbbbb';
  const runAssetCachePath = join(CHAT_FILE_ASSET_CACHE_DIR, `${runAssetId}.md`);
  writeFileSync(runAssetCachePath, '# Summary\n', 'utf8');
  writeFileSync(
    join(CHAT_FILE_ASSETS_DIR, `${runAssetId}.json`),
    JSON.stringify({
      id: runAssetId,
      sessionId: rootSession.id,
      status: 'ready',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      createdBy: 'assistant',
      originalName: 'summary.md',
      mimeType: 'text/markdown',
      localizedPath: runAssetCachePath,
      localizedAt: now.toISOString(),
      storage: { objectKey: 'tmp/summary.md' },
    }, null, 2),
    'utf8',
  );

  await appendEvent(rootSession.id, messageEvent('user', '查一下为什么存储增长这么快。', [
    { savedPath: imagePath, originalName: 'evidence.txt', mimeType: 'text/plain' },
    { assetId, originalName: 'report.txt', mimeType: 'text/plain' },
  ]));
  await appendEvent(rootSession.id, messageEvent('assistant', '已经定位到 history 碎文件、runs 副本和日志累积。'));
  await appendEvent(rootSession.id, fileChangeEvent('/Users/kualshown/Desktop/melody-sync/backend/session-manager.mjs', 'update'));

  const run = await createRun({
    status: {
      sessionId: rootSession.id,
      requestId: 'req_delete_permanent',
      state: 'completed',
      tool: 'codex',
    },
    manifest: {},
  });
  await updateRun(run.id, (current) => ({
    ...current,
    publishedResultAssets: [
      { assetId: runAssetId, originalName: 'summary.md', mimeType: 'text/markdown' },
    ],
    finalizedAt: new Date().toISOString(),
  }));

  await assert.rejects(
    deleteSessionPermanently(rootSession.id),
    /请先归档任务，再删除/,
    'active tasks should require archiving before permanent deletion',
  );

  await setSessionArchived(rootSession.id, true);
  const outcome = await deleteSessionPermanently(rootSession.id);
  assert.deepEqual(
    new Set(outcome.deletedSessionIds),
    new Set([rootSession.id, childSession.id]),
    'deleting a root task should cascade to its branch sessions',
  );

  const remainingSessions = await listSessions();
  assert.equal(
    remainingSessions.some((session) => session.id === rootSession.id || session.id === childSession.id),
    false,
    'deleted sessions should disappear from session listings',
  );
  assert.equal(existsSync(imagePath), false, 'managed saved attachments should be deleted');
  assert.equal(existsSync(join(CHAT_FILE_ASSETS_DIR, `${assetId}.json`)), false, 'history-linked file asset metadata should be deleted');
  assert.equal(existsSync(cachedAssetPath), false, 'history-linked file asset cache should be deleted');
  assert.equal(existsSync(join(CHAT_FILE_ASSETS_DIR, `${runAssetId}.json`)), false, 'run-published file asset metadata should be deleted');
  assert.equal(existsSync(runAssetCachePath), false, 'run-published file asset cache should be deleted');
  assert.equal(existsSync(runDir(run.id)), false, 'run directories should be deleted');

  const noteText = readFileSync(notePath, 'utf8');
  assert.match(noteText, /存储清理/);
  assert.match(noteText, /已定位 history 碎文件问题/);
  assert.match(noteText, /backend\/session-manager\.mjs/);
  assert.match(noteText, /删除任务时先写日记再清理。/);

  killAll();
  console.log('test-session-delete-permanent: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
