#!/usr/bin/env node
import assert from 'assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'melodysync-memory-writeback-'));
const memoryDir = path.join(tempHome, '.melodysync', 'memory');

process.env.HOME = tempHome;
process.env.MELODYSYNC_MEMORY_DIR = memoryDir;

await fs.mkdir(memoryDir, { recursive: true });

const { WORKBENCH_MEMORY_CANDIDATES_FILE } = await import('../lib/config.mjs');
const { memoryWritebackHook } = await import('../backend/hooks/memory-writeback-hook.mjs');

await memoryWritebackHook({
  sessionId: 'session-memory-1',
  session: { name: '记忆系统改造' },
  manifest: {},
  resultEnvelope: {
    memoryCandidates: [
      {
        scope: 'project',
        text: 'pointer-first activation 是当前架构约束',
        source: 'agent',
      },
    ],
  },
});

const stagedTaskNote = await fs.readFile(path.join(memoryDir, 'tasks', 'session-memory-1.md'), 'utf8');
assert.match(stagedTaskNote, /## Memory candidates/);
assert.match(stagedTaskNote, /status=candidate/);
assert.match(stagedTaskNote, /target=context-digest/);
assert.match(stagedTaskNote, /pointer-first activation 是当前架构约束/);

const stagedQueue = JSON.parse(await fs.readFile(WORKBENCH_MEMORY_CANDIDATES_FILE, 'utf8'));
assert.equal(Array.isArray(stagedQueue), true);
assert.equal(stagedQueue.length, 1);
assert.equal(stagedQueue[0].status, 'candidate');

await memoryWritebackHook({
  sessionId: 'session-memory-1',
  session: { name: '记忆系统改造' },
  manifest: {},
  resultEnvelope: {
    memoryCandidates: [
      {
        scope: 'user',
        text: '用户偏好先看 diff 再决定是否合并',
        source: 'agent',
        target: 'agent-profile',
        status: 'approved',
      },
    ],
  },
});

const profileMemory = await fs.readFile(path.join(memoryDir, 'agent-profile.md'), 'utf8');
assert.match(profileMemory, /## Auto-captured/);
assert.match(profileMemory, /用户偏好先看 diff 再决定是否合并/);

await memoryWritebackHook({
  sessionId: 'session-memory-1',
  session: { name: '记忆系统改造' },
  manifest: {},
  resultEnvelope: {
    memoryCandidates: [
      {
        scope: 'project',
        text: '旧版 prompt cache 规则可以删除',
        source: 'agent',
        target: 'skills',
        status: 'rejected',
        type: 'skill',
        reason: '已被新的 memory activation 替代',
      },
    ],
  },
});

const rejectedTaskNote = await fs.readFile(path.join(memoryDir, 'tasks', 'session-memory-1.md'), 'utf8');
assert.match(rejectedTaskNote, /## Rejected memory candidates/);
assert.match(rejectedTaskNote, /status=rejected/);
assert.match(rejectedTaskNote, /target=skills/);
assert.match(rejectedTaskNote, /已被新的 memory activation 替代/);

console.log('test-memory-writeback-hook: ok');
