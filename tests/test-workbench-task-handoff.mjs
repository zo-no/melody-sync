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
  const {
    loadHistory,
  } = await importFromRepo('backend/history.mjs');

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

  // buildTaskDataHandoffPacket 仍用于前端 preview，验证其结构不变
  const previewPacket = buildTaskDataHandoffPacket({
    sourceSession: {
      ...sourceSession,
      taskCard: {
        goal: '整理运行数据',
        mainGoal: '整理运行数据',
        lineRole: 'main',
        summary: '归纳运行结论',
        checkpoint: '优先梳理运行期发现的约束和结论',
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

  // handoffSessionData 核心行为：向目标 session 写入一条消息
  const outcome = await handoffSessionData(sourceSession.id, {
    targetSessionId: targetSession.id,
    detailLevel: 'focused',
  });

  assert.ok(outcome?.session?.id === targetSession.id, 'outcome should return the target session');
  assert.ok(typeof outcome?.sourceTitle === 'string' && outcome.sourceTitle.length > 0, 'outcome should carry sourceTitle');

  // 目标 session 的对话历史里应有一条 task_handoff_note 消息
  const history = await loadHistory(targetSession.id, { includeBodies: true });
  const handoffNote = history.find((event) => event?.messageKind === 'task_handoff_note');

  assert.ok(handoffNote, 'target session history should contain a task_handoff_note event');
  assert.equal(handoffNote.role, 'assistant', 'handoff note should be an assistant message');
  assert.equal(handoffNote.sourceSessionId, sourceSession.id, 'handoff note should record the source session id');
  assert.ok(
    typeof handoffNote.content === 'string' && handoffNote.content.includes('整理运行数据'),
    'handoff note content should include the source session title',
  );
  assert.ok(
    handoffNote.content.includes('需要先实现 A 到 B 的结构化交接'),
    'handoff note content should include source knownConclusions',
  );

  // 目标 session 的 taskCard 不应被修改
  const targetHistory = await loadHistory(targetSession.id, { includeBodies: true });
  assert.ok(targetHistory.length > 0, 'target session should have history');

  console.log('test-workbench-task-handoff: ok');
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
}
