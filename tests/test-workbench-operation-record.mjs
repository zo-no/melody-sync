#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

function importFromRepo(relativePath) {
  return import(pathToFileURL(join(repoRoot, relativePath)).href);
}

async function main() {
  const home = mkdtempSync(join(tmpdir(), 'melodysync-operation-record-home-'));
  const workdir = mkdtempSync(join(tmpdir(), 'melodysync-operation-record-work-'));
  process.env.HOME = home;
  mkdirSync(join(home, '.config', 'melody-sync'), { recursive: true });

  const {
    createSession,
    updateSessionTaskCard,
  } = await importFromRepo('backend/session/manager.mjs');
  const {
    appendEvent,
  } = await importFromRepo('backend/history.mjs');
  const {
    messageEvent,
  } = await importFromRepo('backend/normalizer.mjs');
  const {
    mutateSessionMeta,
  } = await importFromRepo('backend/session/meta-store.mjs');
  const {
    createBranchFromSession,
    getSessionOperationRecords,
    syncSessionContinuityFromSession,
  } = await importFromRepo('backend/workbench/index.mjs');
  const {
    WORKBENCH_BRANCH_CONTEXTS_FILE,
  } = await importFromRepo('lib/config.mjs');

  const mainSession = await createSession(workdir, 'codex', '电影史路线规划', {});
  const seededMain = await updateSessionTaskCard(mainSession.id, {
    goal: '电影史路线规划',
    mainGoal: '电影史路线规划',
    lineRole: 'main',
    summary: '先搭主线，再决定是否拆支线',
    checkpoint: '先搭电影史主线',
    nextSteps: ['先搭电影史主线'],
  });
  await syncSessionContinuityFromSession(seededMain, { taskCard: seededMain?.taskCard });
  await appendEvent(mainSession.id, messageEvent('user', '先搭电影史主线', []));

  const { session: branchSession } = await createBranchFromSession(mainSession.id, {
    goal: '法国新浪潮',
    branchReason: '从主线里拆出风格支线',
    checkpointSummary: '补充跳切与作者论',
    nextStep: '补充跳切与作者论',
  });
  await appendEvent(branchSession.id, messageEvent('user', '补充法国新浪潮', []));

  const { session: nestedBranchSession } = await createBranchFromSession(branchSession.id, {
    goal: '作者论',
    branchReason: '从法国新浪潮支线里继续拆出理论支线',
    checkpointSummary: '对比特吕弗和戈达尔',
    nextStep: '对比特吕弗和戈达尔',
  });

  await mutateSessionMeta(nestedBranchSession.id, (draft) => {
    draft.rootSessionId = '';
    draft.updatedAt = new Date().toISOString();
    return true;
  });

  const rawContexts = JSON.parse(readFileSync(WORKBENCH_BRANCH_CONTEXTS_FILE, 'utf8'));
  const branchContexts = Array.isArray(rawContexts) ? rawContexts : (rawContexts.branchContexts || []);
  const branchContext = branchContexts.find((entry) => entry.sessionId === branchSession.id);
  assert.ok(branchContext, 'seeded branch context should exist');
  branchContexts.push({
    ...branchContext,
    id: `${branchContext.id}_stale`,
    status: 'merged',
    forkAtSeq: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  writeFileSync(
    WORKBENCH_BRANCH_CONTEXTS_FILE,
    JSON.stringify(Array.isArray(rawContexts) ? branchContexts : { ...rawContexts, branchContexts }, null, 2),
    'utf8',
  );

  const operationRecord = await getSessionOperationRecords(nestedBranchSession.id);
  assert.equal(
    operationRecord.sessionId,
    mainSession.id,
    'nested branch records should resolve back to the real main session even when rootSessionId is missing',
  );
  assert.equal(
    operationRecord.items.some((item) => item.type === 'commit' && item.preview === '先搭电影史主线'),
    true,
    'operation record should still show mainline user messages',
  );
  const topBranchEntries = operationRecord.items.filter((item) => item.type === 'branch' && item.branchSessionId === branchSession.id);
  assert.equal(
    topBranchEntries.length,
    1,
    'operation record should dedupe repeated branch contexts for the same session',
  );
  assert.equal(
    topBranchEntries[0]?.status,
    'active',
    'operation record should keep the latest branch context instead of surfacing a stale merged copy',
  );
  assert.equal(
    topBranchEntries[0]?.subBranches?.some((entry) => entry.branchSessionId === nestedBranchSession.id),
    true,
    'operation record should keep nested child branches attached under the surviving parent branch',
  );

  rmSync(home, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
  console.log('test-workbench-operation-record: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
