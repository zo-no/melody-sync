#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const home = mkdtempSync(join(tmpdir(), 'melodysync-daily-maintenance-home-'));
const workdir = mkdtempSync(join(tmpdir(), 'melodysync-daily-maintenance-work-'));

process.env.HOME = home;
delete process.env.MELODYSYNC_CONFIG_DIR;
delete process.env.MELODYSYNC_MEMORY_DIR;
delete process.env.MELODYSYNC_INSTANCE_ROOT;
delete process.env.MELODYSYNC_OBSIDIAN_VAULT_DIR;
delete process.env.MELODYSYNC_OBSIDIAN_PATH;

const configDir = join(home, '.config', 'melody-sync');
mkdirSync(configDir, { recursive: true });
writeFileSync(
  join(configDir, 'tools.json'),
  JSON.stringify([{ id: 'codex', name: 'Codex', command: 'codex', runtimeFamily: 'codex-json' }], null, 2),
  'utf8',
);

function importFromRepo(relativePath) {
  return import(pathToFileURL(join(repoRoot, relativePath)).href);
}

try {
  const config = await importFromRepo('lib/config.mjs');
  const sessionManager = await importFromRepo('backend/session/manager.mjs');
  const metaStore = await importFromRepo('backend/session/meta-store.mjs');
  const { scanDailySessionMaintenance } = await importFromRepo('backend/session-persistent/daily-maintenance.mjs');

  const {
    CONFIG_DIR,
    MEMORY_DIR,
  } = config;
  const {
    createSession,
    getSession,
    killAll,
    updateSessionTaskCard,
  } = sessionManager;
  const { mutateSessionMeta } = metaStore;

  const olderDone = await createSession(workdir, 'codex', '整理归档闭环');
  await updateSessionTaskCard(olderDone.id, {
    goal: '把圆圈改成完成待归档',
    summary: '完成态先划线，再等午夜归档',
    checkpoint: '补午夜 maintenance 与长期记忆沉淀',
    knownConclusions: ['圆圈不该直接 archive'],
    memory: ['done 需要保留到日切后再清理'],
  });
  await mutateSessionMeta(olderDone.id, (draft) => {
    draft.workflowState = 'done';
    draft.workflowCompletedAt = '2026-04-10T15:30:00.000Z';
    draft.updatedAt = '2026-04-10T15:30:00.000Z';
    return true;
  });

  const freshDone = await createSession(workdir, 'codex', '零点后刚完成');
  await updateSessionTaskCard(freshDone.id, {
    goal: '确认午夜 cutoff 不误伤',
    summary: '零点后的完成项要留到下一次 sweep',
  });
  await mutateSessionMeta(freshDone.id, (draft) => {
    draft.workflowState = 'done';
    draft.workflowCompletedAt = '2026-04-11T00:01:00.000Z';
    draft.updatedAt = '2026-04-11T00:01:00.000Z';
    return true;
  });

  const waitingPersistent = await createSession(workdir, 'codex', '等待确认任务');
  await mutateSessionMeta(waitingPersistent.id, (draft) => {
    draft.workflowState = 'done';
    draft.workflowCompletedAt = '2026-04-10T12:00:00.000Z';
    draft.updatedAt = '2026-04-10T12:00:00.000Z';
    draft.persistent = {
      kind: 'waiting_task',
      digest: {
        title: '等待确认任务',
      },
      loop: {
        collect: { sources: [] },
        organize: {},
        use: {},
        prune: {},
      },
    };
    return true;
  });

  const beforeSweep = await getSession(olderDone.id);
  assert.match(beforeSweep?.workflowCompletedAt || '', /^2026-04-10T15:30:00.000Z$/, 'done transitions should persist workflowCompletedAt for later sweeps');

  const firstSweep = await scanDailySessionMaintenance('2026-04-11T00:05:00.000Z');
  assert.equal(firstSweep?.ran, true, 'first sweep after a new local day should run');
  assert.equal(firstSweep?.archivedCount, 1, 'only sessions completed before the new day should be archived');
  assert.deepEqual(firstSweep?.archivedSessionIds, [olderDone.id], 'the older done task should be the only archived session');

  const archivedSession = await getSession(olderDone.id);
  const stillActiveSession = await getSession(freshDone.id);
  const waitingPersistentSession = await getSession(waitingPersistent.id);
  assert.equal(archivedSession?.archived, true, 'older done tasks should be archived by the midnight sweep');
  assert.notEqual(stillActiveSession?.archived, true, 'tasks completed after midnight should stay active until the next sweep');
  assert.notEqual(waitingPersistentSession?.archived, true, 'persistent waiting tasks should be excluded from the nightly archive sweep');

  const worklogPath = join(MEMORY_DIR, 'worklog', '2026', '04', '2026-04-10.md');
  assert.ok(existsSync(worklogPath), 'midnight sweep should write the human-readable completion log to the previous day worklog');
  const worklog = readFileSync(worklogPath, 'utf8');
  assert.match(worklog, /已自动归档 1 项已完成任务/, 'worklog should contain the positive nightly archive summary');
  assert.match(worklog, /整理归档闭环/, 'worklog should list the archived task title');

  const taskMemoryPath = join(MEMORY_DIR, 'tasks', `${olderDone.id}.md`);
  assert.ok(existsSync(taskMemoryPath), 'midnight sweep should write an archive digest for the completed task');
  const taskMemory = readFileSync(taskMemoryPath, 'utf8');
  assert.match(taskMemory, /Archive Digest/, 'task memory should contain the archive digest section');
  assert.match(taskMemory, /圆圈不该直接 archive/, 'task memory should retain the archived task conclusions');

  const contextDigestPath = join(MEMORY_DIR, 'context-digest.md');
  assert.ok(existsSync(contextDigestPath), 'midnight sweep should append agent-facing digest material');
  const contextDigest = readFileSync(contextDigestPath, 'utf8');
  assert.match(contextDigest, /2026-04-10：自动归档 1 项任务/, 'context digest should summarize the nightly archive batch');
  assert.match(contextDigest, /整理归档闭环：目标 补午夜 maintenance 与长期记忆沉淀/, 'context digest should keep an agent-readable recap of the archived task');

  const maintenanceStatePath = join(CONFIG_DIR, 'session-daily-maintenance.json');
  assert.ok(existsSync(maintenanceStatePath), 'maintenance should persist a day-level sweep checkpoint');

  const secondSweep = await scanDailySessionMaintenance('2026-04-11T00:06:00.000Z');
  assert.equal(secondSweep?.ran, false, 'the same local day should not run the sweep twice');
  assert.equal(secondSweep?.skipped, 'already_processed', 'repeat sweeps should report their skip reason');

  killAll();
  rmSync(home, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
  console.log('test-session-daily-maintenance: ok');
} catch (error) {
  rmSync(home, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
}
