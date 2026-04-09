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
  const {
    buildTaskDataHandoffPacket,
    handoffSessionData,
  } = await importFromRepo('backend/workbench/index.mjs');

  const sourceSession = await createSession(workdir, 'codex', '整理运行数据', {});
  const targetSession = await createSession(workdir, 'codex', '把 handoff 入口接到任务边上', {});

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
    goal: '把 handoff 入口接到任务边上',
    mainGoal: '把 handoff 入口接到任务边上',
    lineRole: 'main',
    summary: '目标任务',
    nextSteps: ['先把边上的 handoff 交互做顺'],
    knownConclusions: ['先保持当前开发计划稳定'],
  });

  const previewPacket = buildTaskDataHandoffPacket({
    sourceSession: {
      ...sourceSession,
      taskCard: {
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
      },
    },
    targetSession: {
      ...targetSession,
      taskCard: {
        goal: '把 handoff 入口接到任务边上',
        mainGoal: '把 handoff 入口接到任务边上',
        lineRole: 'main',
        nextSteps: ['先把边上的 handoff 交互做顺'],
        knownConclusions: ['先保持当前开发计划稳定'],
      },
    },
    detailLevel: 'full',
  });

  assert.equal(previewPacket.detailLevel, 'full', 'handoff packet should keep the requested detail level');
  assert.equal(previewPacket.sourceContext?.goal, '整理运行数据', 'handoff packet should expose source context');
  assert.equal(previewPacket.targetContext?.goal, '把 handoff 入口接到任务边上', 'handoff packet should expose target context');
  assert.equal(
    previewPacket.sections?.focus?.some((entry) => entry.includes('源任务目标')),
    true,
    'handoff packet should expose an explicit source focus section',
  );
  assert.equal(
    previewPacket.sections?.focus?.some((entry) => entry.includes('目标任务目标')),
    true,
    'handoff packet should expose an explicit target focus section',
  );
  assert.equal(
    previewPacket.sections?.integration?.some((entry) => entry.includes('把 handoff 入口接到任务边上') || entry.includes('handoff 入口')),
    true,
    'handoff packet should generate target-aware integration guidance',
  );

  const outcome = await handoffSessionData(sourceSession.id, {
    targetSessionId: targetSession.id,
    detailLevel: 'focused',
  });

  assert.equal(outcome?.packet?.sourceSessionId, sourceSession.id, 'handoff packet should keep the source session id');
  assert.equal(outcome?.packet?.targetSessionId, targetSession.id, 'handoff packet should keep the target session id');
  assert.equal(outcome?.packet?.detailLevel, 'focused', 'handoff packet should preserve the requested runtime detail level');
  assert.equal(
    Array.isArray(outcome?.packet?.sections?.conclusions) && outcome.packet.sections.conclusions.length > 0,
    true,
    'handoff packet should carry a structured conclusion section',
  );
  assert.equal(
    Array.isArray(outcome?.packet?.sections?.integration) && outcome.packet.sections.integration.length > 0,
    true,
    'handoff packet should carry target-aware integration guidance',
  );

  const nextTaskCard = outcome?.session?.taskCard || {};
  assert.equal(nextTaskCard.goal, '把 handoff 入口接到任务边上', 'handoff should not overwrite the target goal');
  assert.equal(nextTaskCard.mainGoal, '把 handoff 入口接到任务边上', 'handoff should not overwrite the target mainGoal');
  assert.equal(
    nextTaskCard.background?.some((entry) => entry.includes('来自任务')),
    true,
    'target task should record that a handoff arrived from the source task',
  );
  assert.equal(
    nextTaskCard.background?.some((entry) => entry.includes('源任务目标')),
    true,
    'target task should keep the richer handoff focus context',
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
    nextTaskCard.nextSteps?.some((entry) => entry.includes('可并入')),
    true,
    'target task should receive an integration-oriented next step from the handoff packet',
  );
  assert.equal(
    nextTaskCard.memory?.some((entry) => entry.includes('已接收来自')),
    true,
    'target task should keep a durable memory entry for the handoff source',
  );
  assert.equal(
    nextTaskCard.memory?.includes('交接细节：focused'),
    true,
    'target task should record which handoff detail level was applied',
  );

  console.log('test-workbench-task-handoff: ok');
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
}
