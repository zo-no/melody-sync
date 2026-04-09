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

const home = mkdtempSync(join(tmpdir(), 'melodysync-task-handoff-home-'));
const workdir = mkdtempSync(join(tmpdir(), 'melodysync-task-handoff-work-'));

try {
  process.env.HOME = home;
  mkdirSync(join(home, '.config', 'melody-sync'), { recursive: true });

  const {
    createSession,
    updateSessionTaskCard,
  } = await importFromRepo('backend/session/manager.mjs');
  const { handoffSessionData } = await importFromRepo('backend/workbench/index.mjs');

  const sourceSession = await createSession(workdir, 'codex', '整理运行数据', {});
  const targetSession = await createSession(workdir, 'codex', '推进后续开发', {});

  await updateSessionTaskCard(sourceSession.id, {
    goal: '整理运行数据',
    mainGoal: '整理运行数据',
    lineRole: 'main',
    summary: '归纳运行结论',
    checkpoint: '优先梳理运行期发现的约束和结论',
    background: ['最新回归里已经收集到多条运行日志'],
    rawMaterials: ['日志显示 edge 按钮还没有落到连线上'],
    assumptions: ['目标任务暂时不要直接改 goal'],
    knownConclusions: ['需要先实现 A 到 B 的结构化交接'],
    nextSteps: ['把 handoff 入口做到 edge 上'],
  });

  await updateSessionTaskCard(targetSession.id, {
    goal: '推进后续开发',
    mainGoal: '推进后续开发',
    lineRole: 'main',
    summary: '目标任务',
    knownConclusions: ['先保持当前开发计划稳定'],
  });

  const outcome = await handoffSessionData(sourceSession.id, {
    targetSessionId: targetSession.id,
  });

  assert.equal(outcome?.packet?.sourceSessionId, sourceSession.id, 'handoff packet should keep the source session id');
  assert.equal(outcome?.packet?.targetSessionId, targetSession.id, 'handoff packet should keep the target session id');
  assert.equal(
    Array.isArray(outcome?.packet?.sections?.conclusions) && outcome.packet.sections.conclusions.length > 0,
    true,
    'handoff packet should carry a structured conclusion section',
  );

  const nextTaskCard = outcome?.session?.taskCard || {};
  assert.equal(nextTaskCard.goal, '推进后续开发', 'handoff should not overwrite the target goal');
  assert.equal(nextTaskCard.mainGoal, '推进后续开发', 'handoff should not overwrite the target mainGoal');
  assert.equal(
    nextTaskCard.background?.some((entry) => entry.includes('来自任务')),
    true,
    'target task should record that a handoff arrived from the source task',
  );
  assert.equal(
    nextTaskCard.assumptions?.includes('目标任务暂时不要直接改 goal'),
    true,
    'target task should receive structured constraints from the source task',
  );
  assert.equal(
    nextTaskCard.knownConclusions?.includes('需要先实现 A 到 B 的结构化交接'),
    true,
    'target task should receive source conclusions',
  );
  assert.equal(
    nextTaskCard.nextSteps?.includes('把 handoff 入口做到 edge 上'),
    true,
    'target task should receive source next steps',
  );
  assert.equal(
    nextTaskCard.memory?.some((entry) => entry.includes('已接收来自')),
    true,
    'target task should keep a durable memory entry for the handoff source',
  );

  console.log('test-workbench-task-handoff: ok');
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
}
