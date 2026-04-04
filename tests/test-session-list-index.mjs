#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-session-index-'));

process.env.HOME = tempHome;
delete process.env.REMOTELAB_CONFIG_DIR;
delete process.env.REMOTELAB_MEMORY_DIR;
delete process.env.REMOTELAB_INSTANCE_ROOT;
delete process.env.REMOTELAB_OBSIDIAN_VAULT_DIR;
delete process.env.REMOTELAB_OBSIDIAN_PATH;

const configDir = join(tempHome, '.config', 'melody-sync');
const appRoot = join(tempHome, 'vault', '00-🤖agent');

mkdirSync(configDir, { recursive: true });
mkdirSync(appRoot, { recursive: true });
writeFileSync(
  join(configDir, 'general-settings.json'),
  JSON.stringify({ appRoot }, null, 2),
  'utf8',
);

try {
  const config = await import(pathToFileURL(join(repoRoot, 'lib/config.mjs')).href);
  const store = await import(pathToFileURL(join(repoRoot, 'chat/session-meta-store.mjs')).href);

  await store.withSessionsMetaMutation(async (metas, saveSessionsMeta) => {
    metas.splice(0, metas.length, {
      id: 'session-visible',
      name: '可见会话',
      tool: 'codex',
      group: '收集箱',
      created: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:30:00.000Z',
    }, {
      id: 'session-archived',
      name: '归档会话',
      tool: 'claude',
      archived: true,
      created: '2026-04-03T09:00:00.000Z',
      updatedAt: '2026-04-03T09:30:00.000Z',
    }, {
      id: 'session-internal',
      name: '内部整理',
      tool: 'codex',
      internalRole: 'session_list_organizer',
      created: '2026-04-04T11:00:00.000Z',
      updatedAt: '2026-04-04T11:15:00.000Z',
    });
    await saveSessionsMeta(metas);
  });

  assert.equal(existsSync(config.CHAT_SESSIONS_INDEX_FILE), true, 'sessions index should be written alongside chat-sessions.json');
  const markdown = readFileSync(config.CHAT_SESSIONS_INDEX_FILE, 'utf8');
  assert.match(markdown, /^# Sessions/m, 'sessions index should include a title');
  assert.match(markdown, /## 用户会话/, 'sessions index should include visible sessions section');
  assert.match(markdown, /## 归档会话/, 'sessions index should include archived sessions section');
  assert.match(markdown, /## 内部会话/, 'sessions index should include internal sessions section');
  assert.match(markdown, /`session-visible` · 可见会话/, 'sessions index should include visible session entries');
  assert.match(markdown, /`session-archived` · 归档会话/, 'sessions index should include archived session entries');
  assert.match(markdown, /`session-internal` · 内部整理 .*internalRole: `session_list_organizer`/, 'sessions index should make internal sessions explicit');

  console.log('test-session-list-index: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
