#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-delete-journal-'));

process.env.HOME = tempHome;
delete process.env.MELODYSYNC_CONFIG_DIR;
delete process.env.MELODYSYNC_MEMORY_DIR;
delete process.env.MELODYSYNC_INSTANCE_ROOT;
delete process.env.MELODYSYNC_OBSIDIAN_VAULT_DIR;
delete process.env.MELODYSYNC_OBSIDIAN_PATH;

const configDir = join(tempHome, '.config', 'melody-sync');
const vaultRoot = join(tempHome, 'vault');
const appRoot = join(vaultRoot, '00-🤖agent');
const journalDir = join(vaultRoot, '02-📓journal', '04-📂日记', '2026');
const notePath = join(journalDir, '2026_04_05.md');

mkdirSync(configDir, { recursive: true });
mkdirSync(appRoot, { recursive: true });
mkdirSync(journalDir, { recursive: true });

writeFileSync(
  join(configDir, 'general-settings.json'),
  JSON.stringify({ appRoot }, null, 2),
  'utf8',
);
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

try {
  const journalModule = await import(
    pathToFileURL(join(repoRoot, 'backend', 'session-deletion-journal.mjs')).href
  );

  const { writeSessionDeletionJournalEntry } = journalModule;
  const basePayload = {
    rootSession: {
      id: 'session-root',
      name: '存储清理',
      folder: '/tmp/workspace/melody-sync',
      description: '排查存储膨胀原因',
      taskCard: {
        goal: '定位存储膨胀来源',
        knownConclusions: ['已定位 history 碎文件问题'],
      },
    },
    relatedSessions: [],
    deletedSessionIds: ['session-root'],
    historiesBySessionId: {
      'session-root': [
        {
          type: 'message',
          role: 'user',
          content: '查一下为什么存储增长很快。',
          timestamp: Date.parse('2026-04-05T12:00:00+08:00'),
        },
        {
          type: 'message',
          role: 'assistant',
          content: '已经定位到 history 碎文件、runs 副本和日志累积。',
          timestamp: Date.parse('2026-04-05T12:20:00+08:00'),
        },
        {
          type: 'file_change',
          filePath: '/Users/kualshown/Desktop/melody-sync/backend/session-manager.mjs',
          timestamp: Date.parse('2026-04-05T12:21:00+08:00'),
        },
      ],
    },
  };

  await writeSessionDeletionJournalEntry(basePayload, {
    now: new Date('2026-04-05T12:34:00+08:00'),
  });

  let noteText = readFileSync(notePath, 'utf8');
  assert.match(noteText, /### MelodySync 工作记录/);
  assert.match(noteText, /#### 12:34 存储清理/);
  assert.match(noteText, /已定位 history 碎文件问题/);
  assert.match(noteText, /backend\/session-manager\.mjs/);

  await writeSessionDeletionJournalEntry({
    ...basePayload,
    rootSession: {
      ...basePayload.rootSession,
      taskCard: {
        goal: '定位存储膨胀来源',
        knownConclusions: ['删除任务时先写日记再清理。'],
      },
    },
  }, {
    now: new Date('2026-04-05T13:00:00+08:00'),
  });

  noteText = readFileSync(notePath, 'utf8');
  assert.equal(
    (noteText.match(/melodysync:session:session-root:start/g) || []).length,
    1,
    'same session should replace its existing journal block instead of duplicating it',
  );
  assert.match(noteText, /#### 13:00 存储清理/);
  assert.match(noteText, /删除任务时先写日记再清理。/);
  assert.doesNotMatch(noteText, /#### 12:34 存储清理/);

  const openedVaults = [];
  await assert.rejects(
    writeSessionDeletionJournalEntry({
      ...basePayload,
      rootSession: {
        ...basePayload.rootSession,
        id: 'session-missing',
        name: '缺失日记',
      },
      deletedSessionIds: ['session-missing'],
      historiesBySessionId: { 'session-missing': [] },
    }, {
      now: new Date('2026-04-06T09:00:00+08:00'),
      openVault: async (vaultPath) => {
        openedVaults.push(vaultPath);
      },
    }),
    (error) => {
      assert.equal(error?.statusCode, 409);
      assert.match(String(error?.message || ''), /未找到今日日记文件/);
      return true;
    },
  );
  assert.deepEqual(openedVaults, [vaultRoot], 'missing daily note should open the Obsidian vault root');

  console.log('test-session-deletion-journal: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
