#!/usr/bin/env node
import assert from 'assert/strict';

import {
  buildTaskCardPromptBlock,
  normalizeSessionTaskCard,
  parseTaskCardFromAssistantContent,
  stripTaskCardFromAssistantContent,
  shouldSurfaceTaskCardBranchCandidate,
} from '../backend/session-task-card.mjs';

const normalized = normalizeSessionTaskCard({
  mode: 'project',
  summary: '整理销售周报的 Excel 和 PPT，并产出一版可复用流程。',
  goal: '把手工周报整理流程交给 RemoteLab 处理。',
  background: ['用户每周都要重复整理一次。'],
  rawMaterials: ['sales-weekly.xlsx', 'review-deck.pptx', '截图 2 张'],
  assumptions: ['本周先做一版样例。'],
  knownConclusions: ['原始材料比口头描述更关键。'],
  nextSteps: ['先检查 Excel 和 PPT 的结构', '整理出最小可交付版本'],
  memory: ['用户偏好先看样例再决定是否固化流程。'],
  needsFromUser: ['如果字段含义不清，再补一个示例输出。'],
});

assert.equal(normalized?.mode, 'project');
assert.deepEqual(normalized?.rawMaterials, ['sales-weekly.xlsx', 'review-deck.pptx', '截图 2 张']);

const parsed = parseTaskCardFromAssistantContent([
  '先看材料，我已经开始整理。',
  '<task_card>{',
  '  "mode": "task",',
  '  "summary": "先做一版轻量整理，再决定是否进入项目态。",',
  '  "rawMaterials": ["weekly.xlsx", "ops.pptx"],',
  '  "nextSteps": ["检查字段", "给出样例输出"],',
  '  "memory": ["用户一般直接给原始材料，不喜欢先写长说明"]',
  '}</task_card>',
].join('\n'));

assert.equal(parsed?.mode, 'task');
assert.equal(parsed?.summary, '先做一版轻量整理，再决定是否进入项目态。');
assert.deepEqual(parsed?.nextSteps, ['检查字段', '给出样例输出']);

const parsedEscaped = parseTaskCardFromAssistantContent([
  '继续推进。',
  '<private>',
  '<task_card>{',
  '  "mode": "task",',
  '  "goal": "修复隐藏块兼容性。",',
  '  "lineRole": "main",',
  '  "nextSteps": ["兼容 <\\\\/task_card>"]',
  '}<\\/task_card>',
  '<\\/private>',
].join('\n'));

assert.equal(parsedEscaped?.goal, '修复隐藏块兼容性。');
assert.deepEqual(parsedEscaped?.nextSteps, ['兼容 <\\/task_card>']);

const parsedTrailingJson = parseTaskCardFromAssistantContent([
  '下面是当前任务快照。',
  '',
  '{"mode":"project","summary":"规划任务线","goal":"把主线和支线理顺","candidateBranches":["预算方案","执行清单"],"nextSteps":["先定主线"]}',
].join('\n'));

assert.equal(parsedTrailingJson?.summary, '规划任务线');
assert.deepEqual(parsedTrailingJson?.candidateBranches, ['预算方案', '执行清单']);

assert.equal(
  stripTaskCardFromAssistantContent([
    '我先把主线整理好。',
    '',
    '<task_card>{"summary":"整理主线","nextSteps":["列出候选支线"]}</task_card>',
  ].join('\n')),
  '我先把主线整理好。',
  'visible task-card blocks should be removed from the prose body once parsed',
);

assert.equal(
  stripTaskCardFromAssistantContent([
    '先继续。',
    '',
    '{"mode":"task","summary":"整理候选支线","candidateBranches":["预算方案"]}',
  ].join('\n')),
  '先继续。',
  'trailing task-card JSON should also be removed from the visible assistant prose',
);

const promptBlock = buildTaskCardPromptBlock(parsed);
assert.match(promptBlock, /Current carried task card/);
assert.match(promptBlock, /Execution mode: task/);
assert.match(promptBlock, /Raw materials:/);
assert.match(promptBlock, /weekly\.xlsx/);
assert.match(promptBlock, /Durable user memory:/);
assert.match(promptBlock, /append exactly one final <task_card> JSON block/i);
assert.match(promptBlock, /Do not escape the slash as <\\\/task_card>/);
assert.match(promptBlock, /task-bar subtitle rather than a full sentence description/);
assert.match(promptBlock, /no more than 10 Chinese characters/i);
assert.match(promptBlock, /Prefer a compact verb \+ object form/);

const inferredProject = normalizeSessionTaskCard({
  summary: '材料较多，需要拆步骤推进。',
  rawMaterials: ['a.xlsx', 'b.xlsx', 'c.pptx'],
  nextSteps: ['检查原始材料', '整理结构'],
});

assert.equal(inferredProject?.mode, 'project');

assert.equal(
  shouldSurfaceTaskCardBranchCandidate({
    goal: '完成首页插画',
    mainGoal: '完成首页插画',
    branchReason: '继续把首页插画细化一下',
    nextSteps: ['把首页插画细化一版'],
  }, '首页插画'),
  false,
  'same-goal follow-ups should stay in next-step instead of surfacing a branch suggestion',
);

assert.equal(
  shouldSurfaceTaskCardBranchCandidate({
    goal: '完成首页插画',
    mainGoal: '完成首页插画',
    branchReason: '补充一下光影和色彩说明',
    nextSteps: ['补充光影和色彩说明'],
  }, '光影补充'),
  false,
  'related supplements should stay in the current goal instead of surfacing a branch suggestion',
);

assert.equal(
  shouldSurfaceTaskCardBranchCandidate({
    goal: '完成首页插画',
    mainGoal: '完成首页插画',
    branchReason: '这条线已经偏离当前首页插画目标，需要单独展开成角色设定专题',
    nextSteps: ['先把首页插画完成'],
  }, '角色设定专题'),
  true,
  'explicit goal shifts with an independent topic should surface a branch suggestion',
);

assert.equal(
  shouldSurfaceTaskCardBranchCandidate({
    goal: '完成首页插画',
    mainGoal: '完成首页插画',
    branchReason: '把构图、光影、配色一起再优化一轮',
    nextSteps: ['优化构图、光影和配色'],
  }, '构图优化'),
  false,
  'multiple related refinements inside the same goal should not surface a branch suggestion',
);

const suppressedCandidates = normalizeSessionTaskCard({
  goal: '完成首页插画',
  mainGoal: '完成首页插画',
  branchReason: '继续把首页插画细化一下',
  candidateBranches: ['光影补充', '配色调整', '构图优化'],
  nextSteps: ['继续把首页插画细化一下'],
});

assert.deepEqual(
  suppressedCandidates?.candidateBranches || [],
  [],
  'same-goal refinements should not keep proactive candidate branches on the stored task card',
);

const narrowedCandidates = normalizeSessionTaskCard({
  goal: '完成首页插画',
  mainGoal: '完成首页插画',
  branchReason: '用户已经偏离当前主线，开始转向独立的角色设定专题，这条线需要单独展开。',
  candidateBranches: ['角色设定专题', '世界观整理'],
  nextSteps: ['先把首页插画完成'],
});

assert.deepEqual(
  narrowedCandidates?.candidateBranches || [],
  ['角色设定专题', '世界观整理'],
  'auto branch candidates should keep multiple independent side lines when they are clearly separate from the current goal',
);

console.log('test-session-task-card: ok');
