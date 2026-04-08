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
  const home = mkdtempSync(join(tmpdir(), 'melodysync-branch-session-state-home-'));
  process.env.HOME = home;
  mkdirSync(join(home, '.config', 'melody-sync'), { recursive: true });

  const { syncSessionContinuityFromSession } = await importFromRepo('backend/workbench/index.mjs');

  const result = await syncSessionContinuityFromSession({
    id: 'branch-session-1',
    name: '旧主线标题',
    sourceContext: { parentSessionId: 'main-session-1' },
    sessionState: {
      goal: '按 sessionState 的支线目标',
      mainGoal: '按 sessionState 的主线目标',
      checkpoint: '按 sessionState 的 checkpoint',
      needsUser: false,
      lineRole: 'branch',
      branchFrom: '按 sessionState 的 branchFrom',
    },
    taskCard: {
      goal: '旧 taskCard goal',
      mainGoal: '旧 taskCard mainGoal',
      checkpoint: '旧 taskCard checkpoint',
      lineRole: 'main',
      branchFrom: '旧 taskCard branchFrom',
      summary: '旧 taskCard summary',
      nextSteps: ['旧 next step'],
    },
  }, {
    taskCard: {
      goal: '旧 taskCard goal',
      mainGoal: '旧 taskCard mainGoal',
      checkpoint: '旧 taskCard checkpoint',
      lineRole: 'main',
      branchFrom: '旧 taskCard branchFrom',
      summary: '旧 taskCard summary',
      nextSteps: ['旧 next step'],
    },
    sessionState: {
      goal: '按 sessionState 的支线目标',
      mainGoal: '按 sessionState 的主线目标',
      checkpoint: '按 sessionState 的 checkpoint',
      needsUser: false,
      lineRole: 'branch',
      branchFrom: '按 sessionState 的 branchFrom',
    },
  });

  assert.equal(result?.context?.lineRole, 'branch');
  assert.equal(result?.context?.goal, '按 sessionState 的支线目标');
  assert.equal(result?.context?.mainGoal, '按 sessionState 的主线目标');
  assert.equal(result?.context?.branchFrom, '按 sessionState 的 branchFrom');
  assert.equal(result?.context?.checkpointSummary, '按 sessionState 的 checkpoint');
  assert.equal(result?.context?.resumeHint, '按 sessionState 的 checkpoint');

  rmSync(home, { recursive: true, force: true });
  console.log('test-workbench-branch-lifecycle-session-state: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
