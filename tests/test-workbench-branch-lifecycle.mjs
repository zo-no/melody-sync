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

function sessionDisplayGoal(session) {
  return session?.taskCard?.goal || session?.name || '';
}

async function main() {
  const home = mkdtempSync(join(tmpdir(), 'melodysync-branch-lifecycle-home-'));
  const workdir = mkdtempSync(join(tmpdir(), 'melodysync-branch-lifecycle-work-'));
  process.env.HOME = home;
  mkdirSync(join(home, '.config', 'remotelab'), { recursive: true });

  const {
    createSession,
    setSessionArchived,
    updateSessionTaskCard,
  } = await importFromRepo('chat/session-manager.mjs');
  const {
    createBranchFromSession,
    getWorkbenchSnapshot,
    getWorkbenchTrackerSnapshot,
    mergeBranchSessionBackToMain,
    setBranchSessionStatus,
    syncSessionContinuityFromSession,
  } = await importFromRepo('chat/workbench-store.mjs');

  const mainSession = await createSession(workdir, 'codex', '学习电影史', {});
  assert.ok(mainSession?.id, 'main session should be created');

  const seededMain = await updateSessionTaskCard(mainSession.id, {
    goal: '学习电影史',
    mainGoal: '学习电影史',
    lineRole: 'main',
    checkpoint: '先搭建电影史主线框架',
    nextSteps: ['先搭建电影史主线框架'],
  });
  await syncSessionContinuityFromSession(seededMain, { taskCard: seededMain?.taskCard });

  const { session: branchSession } = await createBranchFromSession(mainSession.id, {
    goal: '表现主义',
    branchReason: '这是从电影史主线里拆出来的一条独立风格支线',
    checkpointSummary: '先把表现主义的核心线索讲清楚',
    nextStep: '先把表现主义这条线单独讲清楚',
  });

  assert.ok(branchSession?.id, 'branch session should be created');
  assert.equal(branchSession.taskCard?.goal, '表现主义', 'branch session should be seeded with branch goal');
  assert.equal(branchSession.taskCard?.mainGoal, '学习电影史', 'branch session should retain main goal');
  assert.equal(branchSession.taskCard?.lineRole, 'branch', 'branch session should be marked as branch');

  const trackerSnapshot = await getWorkbenchTrackerSnapshot(branchSession.id);
  assert.equal(Array.isArray(trackerSnapshot?.taskClusters), true, 'tracker snapshot should include task clusters');
  assert.equal(trackerSnapshot.taskClusters.length, 1, 'tracker snapshot should stay scoped to the current task cluster');
  assert.equal(trackerSnapshot.taskClusters[0]?.mainSessionId, mainSession.id, 'tracker snapshot should point back to the current main session');
  assert.equal(trackerSnapshot.taskClusters[0]?.branchSessionIds?.includes(branchSession.id), true, 'tracker snapshot should include the current branch session');

  await setBranchSessionStatus(branchSession.id, { status: 'parked' });
  let snapshot = await getWorkbenchSnapshot();
  let cluster = (snapshot.taskClusters || []).find((entry) => entry.mainSessionId === mainSession.id);
  let branchEntry = (cluster?.branchSessions || []).find((entry) => entry.id === branchSession.id);
  assert.equal(branchEntry?._branchStatus, 'parked', 'branch should become parked');
  assert.equal(cluster?.currentBranchSessionId || '', '', 'parked branch should no longer be current branch');

  await setBranchSessionStatus(branchSession.id, { status: 'resolved' });
  snapshot = await getWorkbenchSnapshot();
  cluster = (snapshot.taskClusters || []).find((entry) => entry.mainSessionId === mainSession.id);
  branchEntry = (cluster?.branchSessions || []).find((entry) => entry.id === branchSession.id);
  assert.equal(branchEntry?._branchStatus, 'resolved', 'branch should become resolved');
  assert.equal(cluster?.currentBranchSessionId || '', '', 'resolved branch should no longer be current branch');

  await setBranchSessionStatus(branchSession.id, { status: 'active' });
  snapshot = await getWorkbenchSnapshot();
  cluster = (snapshot.taskClusters || []).find((entry) => entry.mainSessionId === mainSession.id);
  branchEntry = (cluster?.branchSessions || []).find((entry) => entry.id === branchSession.id);
  assert.equal(branchEntry?._branchStatus, 'active', 'resolved branch should reopen to active');
  assert.equal(cluster?.currentBranchSessionId, branchSession.id, 'reopened branch should become current branch');

  const mergeOutcome = await mergeBranchSessionBackToMain(branchSession.id, {});
  assert.equal(mergeOutcome?.mergeNote?.branchTitle, '表现主义', 'merge should carry branch title');

  snapshot = await getWorkbenchSnapshot();
  cluster = (snapshot.taskClusters || []).find((entry) => entry.mainSessionId === mainSession.id);
  branchEntry = (cluster?.branchSessions || []).find((entry) => entry.id === branchSession.id);
  assert.equal(branchEntry?._branchStatus, 'merged', 'merge-return should mark branch as merged');

  const mergedMainSession = mergeOutcome?.parentSession;
  assert.ok(sessionDisplayGoal(mergedMainSession).includes('学习电影史'), 'parent session should remain on mainline goal');
  assert.ok(
    Array.isArray(mergedMainSession?.taskCard?.nextSteps) && mergedMainSession.taskCard.nextSteps.length > 0,
    'merged parent session should still have next steps',
  );

  await setSessionArchived(branchSession.id, true);
  await setSessionArchived(mainSession.id, true);
  rmSync(home, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
  console.log('test-workbench-branch-lifecycle: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
