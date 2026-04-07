#!/usr/bin/env node
/**
 * test-task-map-nodes.mjs
 *
 * Tests for workbench/task-map-model.js node generation:
 *   - main node always present
 *   - goal node no longer exists
 *   - candidate nodes from taskCard.candidateBranches
 *   - branch nodes with status
 *   - branch conclusion text from branchContext.checkpointSummary
 *   - done node when all branches are resolved/merged
 */
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const nodeContractSource = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench/node-contract.js'),
  'utf8',
);
const nodeEffectsSource = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench/node-effects.js'),
  'utf8',
);
const nodeInstanceSource = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench', 'node-instance.js'),
  'utf8',
);
const graphModelSource = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench', 'graph-model.js'),
  'utf8',
);
const taskMapClustersSource = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench', 'task-map-clusters.js'),
  'utf8',
);
const taskMapMockPresetsSource = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench', 'task-map-mock-presets.js'),
  'utf8',
);
const source = readFileSync(
  join(repoRoot, 'static', 'frontend', 'workbench/task-map-model.js'),
  'utf8',
);

const context = { console };
context.globalThis = context;
context.window = context;
vm.runInNewContext(nodeContractSource, context, { filename: 'workbench/node-contract.js' });
vm.runInNewContext(nodeEffectsSource, context, { filename: 'workbench/node-effects.js' });
vm.runInNewContext(nodeInstanceSource, context, { filename: 'workbench/node-instance.js' });
vm.runInNewContext(graphModelSource, context, { filename: 'workbench/graph-model.js' });
vm.runInNewContext(taskMapClustersSource, context, { filename: 'workbench/task-map-clusters.js' });
vm.runInNewContext(taskMapMockPresetsSource, context, { filename: 'workbench/task-map-mock-presets.js' });
vm.runInNewContext(source, context, { filename: 'workbench/task-map-model.js' });

const { buildTaskMapProjection, NODE_KINDS } = context.MelodySyncTaskMapModel;
assert.ok(buildTaskMapProjection, 'buildTaskMapProjection should be exposed');
assert.deepEqual(JSON.parse(JSON.stringify(NODE_KINDS)), ['main', 'branch', 'candidate', 'done']);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(overrides = {}) {
  return {
    id: 'sess-main',
    name: '主任务',
    taskCard: null,
    archived: false,
    ...overrides,
  };
}

function makeBranchSession(overrides = {}) {
  return {
    id: 'sess-branch-1',
    name: '支线A',
    taskCard: null,
    archived: false,
    // sourceContext.parentSessionId is used by buildSyntheticClusters
    sourceContext: { parentSessionId: 'sess-main' },
    // _branchStatus is used by getBranchStatus
    _branchStatus: 'active',
    ...overrides,
  };
}

function makeSnapshot(branchContexts = []) {
  return { branchContexts };
}

function project(mainSession, branchSessions = [], snapshot = makeSnapshot()) {
  return buildTaskMapProjection({
    snapshot,
    sessions: [mainSession, ...branchSessions],
    currentSessionId: mainSession.id,
    focusedSessionId: mainSession.id,
  });
}

function getNodes(projection) {
  return projection?.mainQuests?.[0]?.nodes || [];
}

function getNodeKinds(projection) {
  return getNodes(projection).map((n) => n.kind);
}

function getNodeByKind(projection, kind) {
  return getNodes(projection).find((n) => n.kind === kind);
}

function getNodeById(projection, id) {
  return getNodes(projection).find((n) => n.id === id);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// 1. Main node always present
{
  const p = project(makeSession());
  const kinds = getNodeKinds(p);
  assert.ok(kinds.includes('main'), 'main node should always be present');
  console.log('  ✓ main node always present');
}

// 2. Goal node has been removed from the map projection
{
  const session = makeSession({
    name: '主任务',
    taskCard: { goal: '实现登录功能', candidateBranches: [] },
  });
  const p = project(session);
  const kinds = getNodeKinds(p);
  assert.ok(!kinds.includes('goal'), 'goal node should not be generated');
  console.log('  ✓ goal node removed even when taskCard.goal differs from name');
}

// 3. Goal node stays absent when goal matches session name (case-insensitive)
{
  const session = makeSession({
    name: '实现登录功能',
    taskCard: { goal: '实现登录功能', candidateBranches: [] },
  });
  const p = project(session);
  const kinds = getNodeKinds(p);
  assert.ok(!kinds.includes('goal'), 'goal node should NOT appear when goal matches session name');
  console.log('  ✓ goal node absent when goal matches session name');
}

// 4. Goal node absent when no taskCard
{
  const p = project(makeSession({ taskCard: null }));
  assert.ok(!getNodeKinds(p).includes('goal'), 'goal node should not appear without taskCard');
  console.log('  ✓ goal node absent without taskCard');
}

// 5. Candidate nodes from taskCard.candidateBranches
{
  const session = makeSession({
    taskCard: { goal: '主目标', candidateBranches: ['支线X', '支线Y'] },
  });
  const p = project(session);
  const candidates = getNodes(p).filter((n) => n.kind === 'candidate');
  assert.equal(candidates.length, 2, 'should have 2 candidate nodes');
  assert.ok(candidates.some((n) => n.title === '支线X'), 'candidate 支线X present');
  assert.ok(candidates.some((n) => n.title === '支线Y'), 'candidate 支线Y present');
  console.log('  ✓ candidate nodes from candidateBranches');
}

// 6. Candidate deduped against existing branch sessions
{
  const session = makeSession({
    taskCard: { goal: '主目标', candidateBranches: ['支线A', '支线B'] },
  });
  const branch = makeBranchSession({ name: '支线A', _branchStatus: 'active' });
  const p = project(session, [branch]);
  const candidates = getNodes(p).filter((n) => n.kind === 'candidate');
  assert.ok(!candidates.some((n) => n.title === '支线A'), '支线A already exists, should not be candidate');
  assert.ok(candidates.some((n) => n.title === '支线B'), '支线B not yet created, should be candidate');
  console.log('  ✓ candidates deduped against existing branches');
}

// 7. Branch node present with correct status
{
  const session = makeSession({ taskCard: { goal: '主目标', candidateBranches: [] } });
  const branch = makeBranchSession({ _branchStatus: 'parked' });
  const p = project(session, [branch]);
  const branchNode = getNodeByKind(p, 'branch');
  assert.ok(branchNode, 'branch node should be present');
  assert.equal(branchNode.status, 'parked', 'branch node status should be parked');
  console.log('  ✓ branch node with correct status');
}

// 8. Branch conclusion text from branchContext.checkpointSummary when merged
{
  const session = makeSession({ taskCard: { goal: '主目标', candidateBranches: [] } });
  const branch = makeBranchSession({ id: 'sess-branch-merged', _branchStatus: 'merged' });
  const snapshot = makeSnapshot([
    { sessionId: 'sess-branch-merged', checkpointSummary: '已完成接口设计', status: 'merged' },
  ]);
  const p = project(session, [branch], snapshot);
  const branchNode = getNodeByKind(p, 'branch');
  assert.ok(branchNode, 'branch node should be present');
  assert.equal(branchNode.conclusionText, '已完成接口设计', 'merged branch should carry conclusionText');
  assert.equal(branchNode.summary, '已完成接口设计', 'merged branch summary should be conclusionText');
  console.log('  ✓ branch conclusion text from branchContext when merged');
}

// 9. Active branch has no conclusion text
{
  const session = makeSession({ taskCard: { goal: '主目标', candidateBranches: [] } });
  const branch = makeBranchSession({ id: 'sess-branch-active', _branchStatus: 'active' });
  const snapshot = makeSnapshot([
    { sessionId: 'sess-branch-active', checkpointSummary: '进行中', status: 'active' },
  ]);
  const p = project(session, [branch], snapshot);
  const branchNode = getNodeByKind(p, 'branch');
  assert.equal(branchNode.conclusionText, '', 'active branch should have no conclusionText');
  console.log('  ✓ active branch has no conclusion text');
}

// 10. Done node appears when all branches are merged/resolved
{
  const session = makeSession({ taskCard: { goal: '主目标', candidateBranches: [] } });
  const b1 = makeBranchSession({ id: 'b1', _branchStatus: 'merged' });
  const b2 = makeBranchSession({ id: 'b2', _branchStatus: 'resolved' });
  const p = project(session, [b1, b2]);
  const kinds = getNodeKinds(p);
  assert.ok(kinds.includes('done'), 'done node should appear when all branches are merged/resolved');
  console.log('  ✓ done node appears when all branches resolved');
}

// 11. Done node absent when any branch is still active
{
  const session = makeSession({ taskCard: { goal: '主目标', candidateBranches: [] } });
  const b1 = makeBranchSession({ id: 'b1', _branchStatus: 'merged' });
  const b2 = makeBranchSession({ id: 'b2', _branchStatus: 'active' });
  const p = project(session, [b1, b2]);
  assert.ok(!getNodeKinds(p).includes('done'), 'done node should NOT appear while branches are active');
  console.log('  ✓ done node absent while branches still active');
}

// 12. Done node absent when no branches exist (nothing to close)
{
  const session = makeSession({ taskCard: { goal: '主目标', candidateBranches: [] } });
  const p = project(session, []);
  assert.ok(!getNodeKinds(p).includes('done'), 'done node should NOT appear with no branches');
  console.log('  ✓ done node absent when no branches exist');
}

// 13. Full closure: main + 2 merged branches + done
{
  const session = makeSession({
    taskCard: { goal: '完成登录系统', candidateBranches: [] },
  });
  const b1 = makeBranchSession({ id: 'b1', name: 'UI层', _branchStatus: 'merged' });
  const b2 = makeBranchSession({ id: 'b2', name: 'API层', _branchStatus: 'merged' });
  const p = project(session, [b1, b2]);
  const kinds = getNodeKinds(p);
  assert.ok(kinds.includes('main'), 'main present');
  assert.ok(kinds.includes('branch'), 'branch present');
  assert.ok(kinds.includes('done'), 'done present — full closure achieved');
  assert.ok(!kinds.includes('goal'), 'goal remains absent');
  console.log('  ✓ full closure: main + branches + done all present');
}

// 14. Main session workflowState=done should mark the root node as done
{
  const session = makeSession({
    workflowState: 'done',
    taskCard: { goal: '主目标', candidateBranches: [] },
  });
  const p = project(session, []);
  const rootNode = getNodeById(p, 'session:sess-main');
  assert.ok(rootNode, 'root node should be present');
  assert.equal(rootNode.status, 'done', 'done workflowState should surface a done root-node status');
  console.log('  ✓ root node follows workflowState=done');
}

// 15. Synthetic branches should fall back to workflowState when _branchStatus is absent
{
  const session = makeSession({ taskCard: { goal: '主目标', candidateBranches: [] } });
  const branch = makeBranchSession({
    id: 'sess-branch-done',
    _branchStatus: '',
    workflowState: 'done',
  });
  const p = project(session, [branch]);
  const branchNode = getNodeById(p, 'session:sess-branch-done');
  assert.ok(branchNode, 'branch node should be present');
  assert.equal(branchNode.status, 'resolved', 'done workflowState should resolve a finished branch node');
  console.log('  ✓ synthetic branch falls back to workflowState');
}

console.log('\ntest-task-map-nodes: ok');
