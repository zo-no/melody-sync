#!/usr/bin/env node
import assert from 'assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// Set up isolated temp memory dir
const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'melodysync-mem-consol-'));
process.env.HOME = tempHome;
process.env.MELODYSYNC_MEMORY_DIR = path.join(tempHome, 'memory');
await fs.mkdir(process.env.MELODYSYNC_MEMORY_DIR, { recursive: true });

const { memoryConsolidationHook } = await import('../backend/hooks/memory-consolidation-hook.mjs');
const { loadAllActiveEntries } = await import('../backend/memory/memory-store.mjs');

const SESSION_ID = 'test-session-consolidation';
const SESSION_NAME = '测试任务';

// ── Test 1: new knownConclusions → context-digest ────────────────────────────
await memoryConsolidationHook({
  sessionId: SESSION_ID,
  session: { name: SESSION_NAME },
  run: { runSeq: 2 },
  taskCard: {
    goal: '整理记忆系统架构',
    checkpoint: '已完成 store 设计，下一步实现 consolidation hook',
    knownConclusions: [
      '记忆应该按条目存储，不是整文件 append',
      'JSONL 格式便于增量写入和流式读取',
    ],
    memory: [],
  },
  previousTaskCard: {
    goal: '整理记忆系统架构',
    checkpoint: '',
    knownConclusions: [],
    memory: [],
  },
  manifest: null,
});

const entries1 = await loadAllActiveEntries();
const conclusions = entries1.filter((e) => e.target === 'context-digest' && e.type === 'conclusion');
assert.equal(conclusions.length, 2, 'should write 2 new conclusions to context-digest');
assert.ok(conclusions.some((e) => e.text.includes('条目存储')), 'first conclusion should be stored');
assert.ok(conclusions.some((e) => e.text.includes('JSONL')), 'second conclusion should be stored');

const checkpoints = entries1.filter((e) => e.target === 'context-digest' && e.type === 'checkpoint');
assert.equal(checkpoints.length, 1, 'should write checkpoint to context-digest');
assert.ok(checkpoints[0].text.includes('consolidation hook'), 'checkpoint text should match');

// ── Test 2: duplicate conclusions not re-written ─────────────────────────────
await memoryConsolidationHook({
  sessionId: SESSION_ID,
  session: { name: SESSION_NAME },
  run: { runSeq: 3 },
  taskCard: {
    goal: '整理记忆系统架构',
    checkpoint: '已完成 store 设计，下一步实现 consolidation hook',
    knownConclusions: [
      '记忆应该按条目存储，不是整文件 append',  // already stored
      'JSONL 格式便于增量写入和流式读取',          // already stored
    ],
    memory: [],
  },
  previousTaskCard: {
    knownConclusions: [
      '记忆应该按条目存储，不是整文件 append',
      'JSONL 格式便于增量写入和流式读取',
    ],
    memory: [],
  },
  manifest: null,
});

const entries2 = await loadAllActiveEntries();
const conclusions2 = entries2.filter((e) => e.target === 'context-digest' && e.type === 'conclusion');
assert.equal(conclusions2.length, 2, 'no duplicate conclusions should be added');

// ── Test 3: new conclusion added to existing ones ────────────────────────────
await memoryConsolidationHook({
  sessionId: SESSION_ID,
  session: { name: SESSION_NAME },
  run: { runSeq: 4 },
  taskCard: {
    checkpoint: '已完成 store 设计，下一步实现 consolidation hook',
    knownConclusions: [
      '记忆应该按条目存储，不是整文件 append',
      'JSONL 格式便于增量写入和流式读取',
      '检索分数 = 0.3×recency + 0.3×importance + 0.4×relevance',  // new
    ],
    memory: [],
  },
  previousTaskCard: {
    knownConclusions: [
      '记忆应该按条目存储，不是整文件 append',
      'JSONL 格式便于增量写入和流式读取',
    ],
    memory: [],
  },
  manifest: null,
});

const entries3 = await loadAllActiveEntries();
const conclusions3 = entries3.filter((e) => e.target === 'context-digest' && e.type === 'conclusion');
assert.equal(conclusions3.length, 3, 'third conclusion should be added');

// ── Test 4: memory[] items → agent-profile ────────────────────────────────
await memoryConsolidationHook({
  sessionId: SESSION_ID,
  session: { name: SESSION_NAME },
  run: { runSeq: 5 },
  taskCard: {
    checkpoint: '继续',
    knownConclusions: [],
    memory: ['用户偏好简洁回复，不喜欢列表格式'],
  },
  previousTaskCard: {
    knownConclusions: [],
    memory: [],
  },
  manifest: null,
});

const entries4 = await loadAllActiveEntries();
const prefs = entries4.filter((e) => e.target === 'agent-profile' && e.type === 'preference');
assert.equal(prefs.length, 1, 'user preference should be written to agent-profile');
assert.ok(prefs[0].text.includes('简洁回复'), 'preference text should match');

// ── Test 5: first run goal → projects ────────────────────────────────────────
await memoryConsolidationHook({
  sessionId: 'new-session-goal',
  session: { name: '投资组合分析' },
  run: { runSeq: 1 },  // first run
  taskCard: {
    goal: '分析 A 股科技板块的配置机会',
    mainGoal: '分析 A 股科技板块的配置机会',
    checkpoint: '',
    knownConclusions: [],
    memory: [],
  },
  previousTaskCard: null,
  manifest: null,
});

const entries5 = await loadAllActiveEntries();
const goals = entries5.filter((e) => e.target === 'projects' && e.type === 'session-goal');
assert.equal(goals.length, 1, 'first-run goal should be written to projects');
assert.ok(goals[0].text.includes('A 股'), 'goal text should include session goal');

// ── Test 6: internal operations skipped ──────────────────────────────────────
const countBefore = (await loadAllActiveEntries()).length;
await memoryConsolidationHook({
  sessionId: SESSION_ID,
  session: { name: SESSION_NAME },
  run: { runSeq: 6 },
  taskCard: {
    knownConclusions: ['这条不应该被写入'],
    memory: [],
  },
  previousTaskCard: { knownConclusions: [], memory: [] },
  manifest: { internalOperation: true },
});
const countAfter = (await loadAllActiveEntries()).length;
assert.equal(countAfter, countBefore, 'internal operations should not write to memory');

// ── Test 7: source confidence fields are set correctly ───────────────────────
const conclusionEntry = entries3.find((e) => e.type === 'conclusion');
assert.equal(conclusionEntry.source, 'consolidation', 'source should be consolidation');
assert.ok(conclusionEntry.confidence >= 0.7, 'confidence should be set');
assert.ok(conclusionEntry.importance >= 0.7, 'importance should be set');
assert.ok(conclusionEntry.createdAt, 'createdAt should be set');

console.log('test-memory-consolidation-hook: ok');
