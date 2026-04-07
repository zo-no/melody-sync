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
  const home = mkdtempSync(join(tmpdir(), 'melodysync-orphan-branch-home-'));
  const workdir = mkdtempSync(join(tmpdir(), 'melodysync-orphan-branch-work-'));
  process.env.HOME = home;
  mkdirSync(join(home, '.config', 'melody-sync'), { recursive: true });

  const {
    createSession,
    getSession,
    updateSessionTaskCard,
  } = await importFromRepo('backend/session-manager.mjs');
  const {
    getWorkbenchSnapshot,
    syncSessionContinuityFromSession,
  } = await importFromRepo('backend/workbench/index.mjs');
  const {
    mutateSessionMeta,
  } = await importFromRepo('backend/session-meta-store.mjs');

  const mainSession = await createSession(workdir, 'codex', '初始化任务', {});
  assert.ok(mainSession?.id, 'main session should be created');

  const attemptedBranchTaskCard = await updateSessionTaskCard(mainSession.id, {
    goal: '梳理股票发展史',
    mainGoal: '初始化任务',
    lineRole: 'branch',
    branchFrom: '初始化任务',
    branchReason: '用户临时转到股票史专题。',
    summary: '开股票史',
    checkpoint: '先整理中美股市时间线',
  });

  assert.equal(
    attemptedBranchTaskCard?.taskCard?.lineRole,
    'main',
    'top-level sessions should not persist branch role from task-card inference alone',
  );
  assert.equal(
    attemptedBranchTaskCard?.taskCard?.goal,
    '初始化任务',
    'top-level sessions should keep the fixed task title as the main goal anchor',
  );
  assert.equal(
    attemptedBranchTaskCard?.taskCard?.branchFrom || '',
    '',
    'top-level sessions should clear branch lineage fields when repaired back to main',
  );

  await mutateSessionMeta(mainSession.id, (draft) => {
    draft.taskCard = {
      goal: '梳理股票发展史',
      mainGoal: '初始化任务',
      lineRole: 'branch',
      branchFrom: '初始化任务',
      branchReason: '历史脏数据：主线被误写成支线。',
      summary: '开股票史',
      checkpoint: '先整理中美股市时间线',
    };
    draft.updatedAt = new Date().toISOString();
    return true;
  });

  const repairedSession = await getSession(mainSession.id);
  assert.equal(
    repairedSession?.taskCard?.lineRole,
    'main',
    'client-facing session payloads should repair orphan branch task cards back to main',
  );
  assert.equal(
    repairedSession?.taskCard?.goal,
    '初始化任务',
    'repaired main sessions should expose the fixed task title as the visible goal',
  );
  assert.equal(
    repairedSession?.taskCard?.branchFrom || '',
    '',
    'repaired main sessions should no longer expose a branch-from label',
  );

  const continuity = await syncSessionContinuityFromSession(repairedSession, {
    taskCard: repairedSession?.taskCard,
  });
  assert.equal(
    continuity?.context?.lineRole,
    'main',
    'continuity sync should heal orphan branch sessions back into a mainline context',
  );
  assert.equal(
    continuity?.context?.parentSessionId || '',
    '',
    'healed mainline continuity should not keep a phantom parent session id',
  );

  const snapshot = await getWorkbenchSnapshot();
  const cluster = (snapshot.taskClusters || []).find((entry) => entry.mainSessionId === mainSession.id);
  assert.ok(cluster, 'healed top-level session should remain visible as a task-cluster root');
  assert.equal(cluster?.branchCount || 0, 0, 'healed top-level session should not accumulate phantom branch children');
  assert.equal(
    cluster?.mainSession?.taskCard?.lineRole,
    'main',
    'workbench snapshot should expose the repaired session as a mainline task',
  );

  rmSync(home, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
  console.log('test-session-orphan-branch-repair: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
