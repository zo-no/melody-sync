#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

function readWorkbenchFrontendSource(filename) {
  const candidates = [
    join(repoRoot, 'frontend-src', 'workbench', filename),
    join(repoRoot, 'static', 'frontend', 'workbench', filename),
  ];
  const targetPath = candidates.find((candidate) => existsSync(candidate));
  if (!targetPath) {
    throw new Error(`Workbench frontend source not found for ${filename}`);
  }
  return readFileSync(targetPath, 'utf8');
}

const nodeContractSource = readWorkbenchFrontendSource('node-contract.js');
const taskRunStatusSource = readWorkbenchFrontendSource('task-run-status.js');
const nodeEffectsSource = readWorkbenchFrontendSource('node-effects.js');

const context = { console };
context.globalThis = context;
context.window = context;

vm.runInNewContext(nodeContractSource, context, { filename: 'workbench/node-contract.js' });
vm.runInNewContext(taskRunStatusSource, context, { filename: 'workbench/task-run-status.js' });
vm.runInNewContext(nodeEffectsSource, context, { filename: 'workbench/node-effects.js' });

const effectsApi = context.MelodySyncWorkbenchNodeEffects;
assert.ok(effectsApi, 'node effects api should be exposed on globalThis');
assert.equal(typeof effectsApi.getNodeKindEffect, 'function');
assert.equal(typeof effectsApi.buildQuestNodeCounts, 'function');
assert.equal(typeof effectsApi.getNodeTaskRunStatusUi, 'function');

const mainEffect = effectsApi.getNodeKindEffect('main');
assert.equal(mainEffect.layoutVariant, 'root');
assert.equal(mainEffect.interaction, 'open-session');
assert.deepEqual(JSON.parse(JSON.stringify(mainEffect.capabilities)), ['open-session']);
assert.deepEqual(JSON.parse(JSON.stringify(mainEffect.surfaceBindings)), ['task-map']);
assert.deepEqual(JSON.parse(JSON.stringify(mainEffect.taskCardBindings)), ['mainGoal']);
assert.equal(mainEffect.defaultViewType, 'flow-node');
assert.equal(mainEffect.countsAs.sessionNode, true);

const branchEffect = effectsApi.getNodeKindEffect('branch');
assert.equal(branchEffect.interaction, 'open-session');
assert.equal(branchEffect.countsAs.branch, true);

const candidateEffect = effectsApi.getNodeKindEffect('candidate');
assert.equal(candidateEffect.layoutVariant, 'compact');
assert.equal(candidateEffect.edgeVariant, 'suggestion');
assert.equal(candidateEffect.interaction, 'create-branch');
assert.equal(candidateEffect.actionLabel, '开启');
assert.equal(candidateEffect.trackAsCandidateChild, true);
assert.equal(candidateEffect.defaultSummary, '建议拆分');
assert.deepEqual(JSON.parse(JSON.stringify(candidateEffect.capabilities)), ['create-branch', 'dismiss']);
assert.deepEqual(JSON.parse(JSON.stringify(candidateEffect.surfaceBindings)), ['task-map', 'composer-suggestions']);
assert.deepEqual(JSON.parse(JSON.stringify(candidateEffect.taskCardBindings)), ['candidateBranches']);
assert.equal(candidateEffect.countsAs.sessionNode, false);
assert.equal(candidateEffect.countsAs.candidate, true);

const doneEffect = effectsApi.getNodeKindEffect('done');
assert.equal(doneEffect.layoutVariant, 'compact');
assert.equal(doneEffect.edgeVariant, 'completion');
assert.equal(doneEffect.interaction, 'none');
assert.equal(doneEffect.countsAs.completedSummary, true);

const noteEffect = effectsApi.getNodeKindEffect('note');
assert.equal(noteEffect.layoutVariant, 'panel');
assert.equal(noteEffect.edgeVariant, 'related');
assert.equal(noteEffect.interaction, 'none');
assert.equal(noteEffect.defaultViewType, 'markdown');
assert.equal(noteEffect.countsAs.sessionNode, false);

const hydratedCandidate = effectsApi.withNodeKindEffect({
  id: 'candidate:main-1:review',
  kind: 'candidate',
  title: '补充复盘支线',
});
assert.equal(hydratedCandidate.kindEffect.interaction, 'create-branch');
assert.equal(effectsApi.getNodeView(hydratedCandidate).type, 'flow-node');

assert.equal(
  effectsApi.shouldTrackCandidateChild(hydratedCandidate),
  true,
  'candidate nodes should keep their dedicated child collection behavior',
);

const counts = effectsApi.buildQuestNodeCounts([
  { id: 'session:main-1', kind: 'main' },
  { id: 'session:branch-1', kind: 'branch', status: 'active' },
  { id: 'candidate:main-1:review', kind: 'candidate', status: 'candidate' },
  { id: 'done:main-1', kind: 'done', status: 'done' },
]);
assert.deepEqual(
  JSON.parse(JSON.stringify(counts)),
  {
    sessionNodes: 3,
    activeBranches: 1,
    parkedBranches: 0,
    completedBranches: 0,
    candidateBranches: 1,
  },
  'node effects counts should preserve the current task-map counting semantics',
);

const bootstrapContext = {
  console,
  MelodySyncBootstrap: {
    getBootstrap() {
      return {
        workbench: {
          nodeLanes: ['main', 'branch', 'review'],
          nodeRoles: ['state', 'action', 'summary'],
          nodeMergePolicies: ['replace-latest', 'append'],
          nodeKindDefinitions: [
            {
              id: 'review',
              label: '复盘节点',
              description: '用于阶段复盘。',
              lane: 'review',
              role: 'summary',
              sessionBacked: false,
              derived: true,
              mergePolicy: 'append',
              composition: {
                canBeRoot: false,
                allowedParentKinds: ['main', 'review'],
                allowedChildKinds: [],
                requiresSourceSession: true,
                defaultInteraction: 'none',
                defaultEdgeType: 'completion',
                layoutVariant: 'compact',
                countsAs: {
                  sessionNode: false,
                  branch: false,
                  candidate: false,
                  completedSummary: true,
                },
              },
            },
          ],
        },
      };
    },
  },
};
bootstrapContext.globalThis = bootstrapContext;
bootstrapContext.window = bootstrapContext;
vm.runInNewContext(nodeContractSource, bootstrapContext, { filename: 'workbench/node-contract.js' });
vm.runInNewContext(taskRunStatusSource, bootstrapContext, { filename: 'workbench/task-run-status.js' });
vm.runInNewContext(nodeEffectsSource, bootstrapContext, { filename: 'workbench/node-effects.js' });

const customEffect = bootstrapContext.MelodySyncWorkbenchNodeEffects.getNodeKindEffect('review');
assert.equal(customEffect.layoutVariant, 'compact');
assert.equal(customEffect.interaction, 'none');
assert.equal(customEffect.countsAs.sessionNode, false);
assert.equal(customEffect.edgeVariant, 'completion');
assert.equal(customEffect.countsAs.completedSummary, true);
assert.deepEqual(JSON.parse(JSON.stringify(customEffect.surfaceBindings)), ['task-map']);

const markdownView = bootstrapContext.MelodySyncWorkbenchNodeEffects.getNodeView({
  id: 'review-node',
  kind: 'review',
  view: {
    type: 'markdown',
    content: '# 复盘',
    width: 420,
    height: 280,
  },
});
assert.equal(markdownView.type, 'markdown');
assert.equal(markdownView.content, '# 复盘');
assert.equal(markdownView.width, 420);
assert.equal(markdownView.height, 280);

assert.equal(
  bootstrapContext.MelodySyncWorkbenchNodeEffects.getNodeMetaLabel({
    id: 'review-node',
    kind: 'review',
    parentNodeId: 'session:main-1',
    view: {
      type: 'markdown',
      content: '# 复盘',
    },
  }),
  '画布',
  'custom rich-view nodes should expose a neutral canvas badge instead of falling back to branch status labels',
);

assert.equal(
  effectsApi.getNodeMetaLabel({
    id: 'session:branch-running',
    kind: 'branch',
    parentNodeId: 'session:main-1',
    status: 'active',
    activityState: 'running',
    isCurrent: true,
  }),
  '运行中',
  'active running nodes should surface the running badge label',
);

assert.equal(
  effectsApi.getNodeMetaLabel({
    id: 'session:main-busy',
    kind: 'main',
    busy: true,
    isCurrent: true,
  }),
  '运行中',
  'node effects should reuse shared busy semantics so current mainline tasks do not fall back to idle when reduced node fields are sparse',
);

assert.equal(
  effectsApi.getNodeMetaLabel({
    id: 'session:branch-done',
    kind: 'branch',
    parentNodeId: 'session:main-1',
    status: 'active',
    workflowState: 'done',
    isCurrent: true,
  }),
  '已完成',
  'workflowState=done should override current-node running badges',
);

assert.equal(
  effectsApi.getNodeTaskRunStatusUi({
    id: 'session:branch-waiting',
    kind: 'branch',
    parentNodeId: 'session:main-1',
    status: 'active',
    workflowState: 'waiting_user',
  })?.key,
  'waiting_user',
  'node effects should expose the normalized task-run status key for downstream styling',
);

assert.equal(
  effectsApi.getNodeTaskRunStatusUi({
    id: 'session:branch-idle',
    kind: 'branch',
    parentNodeId: 'session:main-1',
    status: 'active',
    isCurrent: false,
  })?.key,
  'idle',
  'task-map nodes should keep showing a stable idle status even when they are not the current node',
);

assert.equal(
  effectsApi.getNodeMetaLabel({
    id: 'session:branch-parked',
    kind: 'branch',
    parentNodeId: 'session:main-1',
    status: 'parked',
  }),
  '已挂起',
  'parked nodes should surface a parked badge label',
);

assert.equal(
  effectsApi.getNodeMetaLabel({
    id: 'session:branch-plain',
    kind: 'review',
    parentNodeId: 'session:main-1',
    status: 'active',
    isCurrent: true,
  }),
  '',
  'unknown status-carrying branch-like nodes should stay silent when there is no meaningful status to show',
);

console.log('test-workbench-node-effects: ok');
