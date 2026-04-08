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
  mkdirSync(join(home, '.config', 'melody-sync'), { recursive: true });

  const {
    createSession,
    setSessionArchived,
    updateSessionTaskCard,
  } = await importFromRepo('backend/session/manager.mjs');
  const { registerHook } = await importFromRepo('backend/hooks/index.mjs');
  const {
    createBranchFromSession,
    getWorkbenchSnapshot,
    getWorkbenchTrackerSnapshot,
    mergeBranchSessionBackToMain,
    reparentSession,
    setBranchSessionStatus,
    syncSessionContinuityFromSession,
  } = await importFromRepo('backend/workbench/index.mjs');

  const mainSession = await createSession(workdir, 'codex', '学习电影史', {});
  assert.ok(mainSession?.id, 'main session should be created');

  const branchLifecycleEvents = [];
  registerHook('branch.opened', async (ctx) => {
    branchLifecycleEvents.push({
      event: ctx.event,
      sessionId: ctx.sessionId,
      parentSessionId: ctx.parentSessionId,
      branchTitle: ctx.branchContext?.goal || '',
    });
  }, {
    id: 'test.branch-opened-capture',
    label: 'test branch opened capture',
  });
  registerHook('branch.merged', async (ctx) => {
    branchLifecycleEvents.push({
      event: ctx.event,
      sessionId: ctx.sessionId,
      parentSessionId: ctx.parentSessionId,
      branchTitle: ctx.mergeNote?.branchTitle || '',
      broughtBack: ctx.mergeNote?.broughtBack || '',
    });
  }, {
    id: 'test.branch-merged-capture',
    label: 'test branch merged capture',
  });

  const seededMain = await updateSessionTaskCard(mainSession.id, {
    goal: '学习电影史',
    mainGoal: '学习电影史',
    lineRole: 'main',
    summary: '电影史主线',
    checkpoint: '先搭建电影史主线框架',
    background: ['当前已经明确古典、现代、当代三段结构'],
    knownConclusions: ['目前已经划出古典、现代、当代三段'],
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
  assert.equal(
    branchSession.taskCard?.background?.some((entry) => entry.includes('主线目标：学习电影史')),
    true,
    'branch session should carry the mainline goal into the seeded branch background',
  );
  assert.equal(
    branchSession.taskCard?.knownConclusions?.includes('目前已经划出古典、现代、当代三段'),
    true,
    'branch session should inherit concise mainline conclusions as carryover context',
  );
  assert.deepEqual(
    branchLifecycleEvents[0],
    {
      event: 'branch.opened',
      sessionId: branchSession.id,
      parentSessionId: mainSession.id,
      branchTitle: '表现主义',
    },
    'branch.opened hook should fire when a branch session is created',
  );

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

  const mergeOutcome = await mergeBranchSessionBackToMain(branchSession.id, {
    mergeType: 'conclusion',
    broughtBack: '已经明确表现主义的视觉语言，可以继续比较其他流派。',
  });
  assert.equal(mergeOutcome?.mergeNote?.branchTitle, '表现主义', 'merge should carry branch title');
  assert.equal(
    mergeOutcome?.mergeNote?.broughtBack,
    '已经明确表现主义的视觉语言，可以继续比较其他流派。',
    'merge should keep the explicit branch wrap-up summary supplied by the caller',
  );
  assert.deepEqual(
    branchLifecycleEvents[1],
    {
      event: 'branch.merged',
      sessionId: mainSession.id,
      parentSessionId: mainSession.id,
      branchTitle: '表现主义',
      broughtBack: '已经明确表现主义的视觉语言，可以继续比较其他流派。',
    },
    'branch.merged hook should fire with the parent session as the visible target',
  );

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

  const reparentMainA = await createSession(workdir, 'codex', '规划周会节奏', {});
  const reparentMainB = await createSession(workdir, 'codex', '梳理发布流程', {});
  const reparentMainASeeded = await updateSessionTaskCard(reparentMainA.id, {
    goal: '规划周会节奏',
    mainGoal: '规划周会节奏',
    lineRole: 'main',
  });
  const reparentMainBSeeded = await updateSessionTaskCard(reparentMainB.id, {
    goal: '梳理发布流程',
    mainGoal: '梳理发布流程',
    lineRole: 'main',
  });
  await syncSessionContinuityFromSession(reparentMainASeeded, { taskCard: reparentMainASeeded.taskCard });
  await syncSessionContinuityFromSession(reparentMainBSeeded, { taskCard: reparentMainBSeeded.taskCard });

  const { session: reparentee } = await createBranchFromSession(reparentMainA.id, {
    goal: '拆解会前准备',
    branchReason: '需要先把周会前准备单独理顺',
    checkpointSummary: '先列出议程、材料和主持口径',
  });
  const { session: reparenteeChild } = await createBranchFromSession(reparentee.id, {
    goal: '补充主持人口径',
    branchReason: '这是会前准备下的一条细分支线',
    checkpointSummary: '先明确主持人开场和收束方式',
  });

  const reparentOutcome = await reparentSession(reparentee.id, {
    targetSessionId: reparentMainB.id,
  });
  assert.equal(reparentOutcome?.session?.taskCard?.lineRole, 'branch', 'reparented session should stay a branch');
  assert.equal(
    reparentOutcome?.session?.taskCard?.branchFrom,
    '梳理发布流程',
    'reparented session should point branchFrom at the new parent session',
  );

  let reparentSnapshot = await getWorkbenchSnapshot();
  let originalCluster = (reparentSnapshot.taskClusters || []).find((entry) => entry.mainSessionId === reparentMainA.id);
  let targetCluster = (reparentSnapshot.taskClusters || []).find((entry) => entry.mainSessionId === reparentMainB.id);
  assert.equal(
    (originalCluster?.branchSessionIds || []).includes(reparentee.id),
    false,
    'reparented session should disappear from the old main cluster',
  );
  assert.equal(
    (targetCluster?.branchSessionIds || []).includes(reparentee.id),
    true,
    'reparented session should appear under the new main cluster',
  );
  assert.equal(
    (targetCluster?.branchSessionIds || []).includes(reparenteeChild.id),
    true,
    'reparent should move the whole subtree into the new cluster',
  );
  assert.equal(
    (targetCluster?.branchSessions || []).find((entry) => entry.id === reparentee.id)?._branchParentSessionId,
    reparentMainB.id,
    'reparented parent branch should now point at the new parent session',
  );
  assert.equal(
    (targetCluster?.branchSessions || []).find((entry) => entry.id === reparenteeChild.id)?._branchParentSessionId,
    reparentee.id,
    'nested child branches should keep their original parent after reparent',
  );

  const detachOutcome = await reparentSession(reparentee.id, {});
  assert.equal(detachOutcome?.session?.taskCard?.lineRole, 'main', 'detaching should promote the session back to main');

  reparentSnapshot = await getWorkbenchSnapshot();
  targetCluster = (reparentSnapshot.taskClusters || []).find((entry) => entry.mainSessionId === reparentMainB.id);
  const detachedCluster = (reparentSnapshot.taskClusters || []).find((entry) => entry.mainSessionId === reparentee.id);
  assert.equal(
    (targetCluster?.branchSessionIds || []).includes(reparentee.id),
    false,
    'detached session should leave the previous parent cluster',
  );
  assert.equal(
    Boolean(detachedCluster),
    true,
    'detached session should become its own main cluster',
  );
  assert.equal(
    (detachedCluster?.branchSessionIds || []).includes(reparenteeChild.id),
    true,
    'detached session should keep its existing child subtree',
  );

  await setSessionArchived(reparenteeChild.id, true);
  await setSessionArchived(reparentee.id, true);
  await setSessionArchived(reparentMainA.id, true);
  await setSessionArchived(reparentMainB.id, true);
  rmSync(home, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
  console.log('test-workbench-branch-lifecycle: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
