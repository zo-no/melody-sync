#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

function importFromRepo(relativePath) {
  return import(pathToFileURL(join(repoRoot, relativePath)).href);
}

async function main() {
  const home = mkdtempSync(join(tmpdir(), 'melodysync-taskcard-state-home-'));
  const workdir = mkdtempSync(join(tmpdir(), 'melodysync-taskcard-state-work-'));
  process.env.HOME = home;
  mkdirSync(join(home, '.config', 'melody-sync'), { recursive: true });

  const {
    createSession,
    getSession,
    updateSessionTaskCard,
  } = await importFromRepo('backend/session-manager.mjs');

  const session = await createSession(workdir, 'codex', '主线会话', {});
  assert.ok(session?.id, 'session should be created');

  await updateSessionTaskCard(session.id, {
    goal: '收敛会话架构',
    mainGoal: '重构会话系统',
    checkpoint: '先把 taskCard 降级为兼容层',
    lineRole: 'branch',
    branchFrom: '重构会话系统',
  });

  const updated = await getSession(session.id);
  assert.deepEqual(
    updated?.sessionState,
    {
      goal: '主线会话',
      mainGoal: '主线会话',
      checkpoint: '先把 taskCard 降级为兼容层',
      needsUser: false,
      lineRole: 'main',
      branchFrom: '',
    },
    'updating taskCard should also keep sessionState synchronized with the stabilized task-card projection so legacy task-card writes do not fork the state truth',
  );

  await updateSessionTaskCard(session.id, {
    goal: '收敛会话架构第二轮',
    mainGoal: '重构会话系统',
  });

  const refreshed = await getSession(session.id);
  assert.equal(
    refreshed?.taskCard?.summary,
    '',
    'taskCard summary should stop carrying forward a legacy summary when the latest task-card payload does not provide one',
  );

  rmSync(home, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
  console.log('test-session-task-card-session-state-sync: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
