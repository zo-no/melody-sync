#!/usr/bin/env node
import assert from 'assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'melodysync-workbench-memory-'));
const memoryDir = path.join(tempHome, '.melodysync', 'memory');

process.env.HOME = tempHome;
process.env.MELODYSYNC_MEMORY_DIR = memoryDir;

await fs.mkdir(memoryDir, { recursive: true });

const {
  stageWorkbenchMemoryCandidate,
  listWorkbenchMemoryCandidatesForSession,
} = await import('../backend/workbench/memory-candidate-store.mjs');
const { handleWorkbenchReadRoutes } = await import('../backend/controllers/workbench/read-routes.mjs');
const { handleWorkbenchWriteRoutes } = await import('../backend/controllers/workbench/write-routes.mjs');
const { updateWorkbenchMemoryCandidateStatusForWrite } = await import('../backend/services/workbench/write-service.mjs');

const staged = await stageWorkbenchMemoryCandidate({
  sessionId: 'session-workbench-1',
  sessionName: '记忆候选评审',
  scope: 'user',
  text: '用户偏好先看 diff 再决定是否合并',
  target: 'agent-profile',
  type: 'profile',
  confidence: 0.91,
});

assert.equal(staged.status, 'candidate');

const listed = await listWorkbenchMemoryCandidatesForSession('session-workbench-1');
assert.equal(listed.length, 1);
assert.equal(listed[0].id, staged.id);

const promoted = await updateWorkbenchMemoryCandidateStatusForWrite(
  'session-workbench-1',
  staged.id,
  { status: 'approved' },
);

assert.equal(promoted.status, 'approved');

const profileMemory = await fs.readFile(path.join(memoryDir, 'agent-profile.md'), 'utf8');
assert.match(profileMemory, /用户偏好先看 diff 再决定是否合并/);

const routeCandidate = await stageWorkbenchMemoryCandidate({
  sessionId: 'session-workbench-route',
  sessionName: '记忆候选路由',
  scope: 'user',
  text: '用户希望默认先给结论，再展开细节',
  target: 'agent-profile',
  type: 'profile',
  confidence: 0.88,
});

const readResult = {};
const readHandled = await handleWorkbenchReadRoutes({
  req: { method: 'GET' },
  res: {},
  pathname: '/api/workbench/sessions/session-workbench-route/memory-candidates',
  authSession: { role: 'owner' },
  requireSessionAccess(_res, _authSession, sessionId) {
    assert.equal(sessionId, 'session-workbench-route');
    return true;
  },
  writeJson(_res, status, payload) {
    readResult.status = status;
    readResult.payload = payload;
  },
});

assert.equal(readHandled, true);
assert.equal(readResult.status, 200);
assert.equal(Array.isArray(readResult.payload.memoryCandidates), true);
assert.equal(readResult.payload.memoryCandidates.length, 1);
assert.equal(readResult.payload.memoryCandidates[0].id, routeCandidate.id);

const writeReq = Readable.from([Buffer.from(JSON.stringify({ status: 'approved' }))]);
writeReq.method = 'POST';
const writeResult = {};
const writeHandled = await handleWorkbenchWriteRoutes({
  req: writeReq,
  res: {},
  pathname: `/api/workbench/sessions/session-workbench-route/memory-candidates/${encodeURIComponent(routeCandidate.id)}/status`,
  authSession: { role: 'owner' },
  requireSessionAccess(_res, _authSession, sessionId) {
    assert.equal(sessionId, 'session-workbench-route');
    return true;
  },
  writeJson(_res, status, payload) {
    writeResult.status = status;
    writeResult.payload = payload;
  },
});

assert.equal(writeHandled, true);
assert.equal(writeResult.status, 200);
assert.equal(writeResult.payload.memoryCandidate?.status, 'approved');

const routeProfileMemory = await fs.readFile(path.join(memoryDir, 'agent-profile.md'), 'utf8');
assert.match(routeProfileMemory, /用户希望默认先给结论，再展开细节/);

console.log('test-workbench-memory-candidates: ok');
