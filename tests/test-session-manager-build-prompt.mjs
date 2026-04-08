#!/usr/bin/env node
import assert from 'assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'melodysync-build-prompt-'));
process.env.HOME = tempHome;

await fs.mkdir(path.join(tempHome, '.config', 'melody-sync'), { recursive: true });
await fs.writeFile(
  path.join(tempHome, '.config', 'melody-sync', 'tools.json'),
  `${JSON.stringify([
    {
      id: 'micro-agent',
      name: 'Micro Agent',
      command: 'codex',
      runtimeFamily: 'codex-json',
      promptMode: 'bare-user',
      flattenPrompt: true,
      models: [{ id: 'gpt-5.4', label: 'gpt-5.4' }],
      reasoning: { kind: 'none', label: 'Thinking' },
    },
  ], null, 2)}\n`,
  'utf8',
);

const { buildPrompt } = await import('../backend/session-manager.mjs');

const baseSession = {
  systemPrompt: '',
  claudeSessionId: null,
  codexThreadId: null,
  activeAgreements: [
    '默认用自然连贯的段落表达，不要自己起标题和列表。',
    'Agent 更像执行器，Manager 负责统一任务语义和边界。',
  ],
};

const freshPrompt = await buildPrompt(
  'session-test-1',
  baseSession,
  '聊一下产品方向。',
  'codex',
  'codex',
  null,
  { skipSessionContinuation: true },
);

assert.match(freshPrompt, /User message:/);
assert.match(freshPrompt, /\[Manager context\]/);
assert.match(freshPrompt, /Current user message:/);
assert.match(freshPrompt, /do not mirror its headings, bullets, or checklist structure back to the user/);
assert.match(freshPrompt, /melodysync session-spawn --task "<focused task>" --wait --internal --output-mode final-only --json/);
assert.match(freshPrompt, /suppresses the visible parent handoff note and returns only the child session's final reply to stdout/);
assert.match(freshPrompt, /Do not send user-facing progress reports just because work is underway/);
assert.match(freshPrompt, /append exactly one final hidden <private><task_card> JSON block/i);
assert.match(freshPrompt, /\[Task-card reply contract\]/);
assert.doesNotMatch(freshPrompt, /active working agreements/);
assert.doesNotMatch(freshPrompt, /Routing principle for this turn/);
assert.doesNotMatch(freshPrompt, /Current carried task card/);

const resumedPrompt = await buildPrompt(
  'session-test-1',
  {
    ...baseSession,
    codexThreadId: 'thread-test-1',
  },
  '继续。',
  'codex',
  'codex',
  null,
  {},
);

assert.match(resumedPrompt, /Current user message:/);
assert.match(resumedPrompt, /append exactly one final hidden <private><task_card> JSON block/i);
assert.match(resumedPrompt, /\[Task-card reply contract\]/);
assert.doesNotMatch(resumedPrompt, /Memory System — Pointer-First Activation/);
assert.doesNotMatch(resumedPrompt, /active working agreements/);

const splitPrompt = await buildPrompt(
  'session-test-6',
  baseSession,
  `现在手上都有哪些任务，我觉得需要关注两点：
1. 现在都积压了哪些任务，我们看下接下来做什么
2. 我们的 TODO 记录是标准流程吗，需不需要做一个定型？`,
  'codex',
  'codex',
  null,
  { skipSessionContinuation: true },
);

assert.doesNotMatch(splitPrompt, /Routing principle for this turn/);
assert.match(splitPrompt, /Current user message:/);
assert.match(splitPrompt, /append exactly one final hidden <private><task_card> JSON block/i);

const observerSourcePrompt = await buildPrompt(
  'session-test-4',
  {
    ...baseSession,
    sourceId: 'observer',
    sourceName: 'Home Coach',
  },
  'Current task:\nWelcome the user home.',
  'codex',
  'codex',
  null,
  { skipSessionContinuation: true },
);

assert.match(observerSourcePrompt, /Output only the text that should be spoken aloud through the speaker/);

const githubSourcePrompt = await buildPrompt(
  'session-test-5',
  {
    ...baseSession,
    sourceId: 'github',
    sourceName: 'GitHub',
  },
  'Source: GitHub\n\nUser message:\nPlease inspect the failure.',
  'codex',
  'codex',
  null,
  { skipSessionContinuation: true },
);

assert.match(githubSourcePrompt, /Produce plain text or markdown suitable for posting back through GitHub/);

const microAgentPrompt = await buildPrompt(
  'session-test-2',
  baseSession,
  '看一下这个项目的背景。',
  'micro-agent',
  'micro-agent',
  null,
  { skipSessionContinuation: true },
);

assert.match(microAgentPrompt, /看一下这个项目的背景/);
assert.doesNotMatch(microAgentPrompt, /Current carried task card/);
assert.doesNotMatch(microAgentPrompt, /active working agreements/);

const promptWithTaskCard = await buildPrompt(
  'session-test-7',
  {
    ...baseSession,
    name: '整理销售周报流程',
    taskCard: {
      mode: 'project',
      summary: '先吃透用户丢来的 Excel 和 PPT，再决定如何组织项目态。',
      rawMaterials: ['sales.xlsx', 'deck.pptx'],
      nextSteps: ['检查材料结构', '整理第一版任务摘要'],
      memory: ['用户偏好直接给原始材料，不想先写长说明。'],
    },
  },
  '继续推进。',
  'codex',
  'codex',
  null,
  { skipSessionContinuation: true },
);

assert.match(promptWithTaskCard, /Current carried task card/);
assert.match(promptWithTaskCard, /\[Task-card reply contract\]/);
assert.match(promptWithTaskCard, /Fixed session task title: 整理销售周报流程/);
assert.match(promptWithTaskCard, /sales\.xlsx/);
assert.match(promptWithTaskCard, /append exactly one final hidden <private><task_card> JSON block/i);
assert.match(promptWithTaskCard, /keep goal and mainGoal anchored to the fixed session task title/i);

console.log('test-session-manager-build-prompt: ok');
