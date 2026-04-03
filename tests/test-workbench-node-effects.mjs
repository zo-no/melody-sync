#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const nodeContractSource = readFileSync(
  join(repoRoot, 'static', 'chat', 'workbench', 'node-contract.js'),
  'utf8',
);
const nodeEffectsSource = readFileSync(
  join(repoRoot, 'static', 'chat', 'workbench', 'node-effects.js'),
  'utf8',
);

const context = { console };
context.globalThis = context;
context.window = context;

vm.runInNewContext(nodeContractSource, context, { filename: 'workbench/node-contract.js' });
vm.runInNewContext(nodeEffectsSource, context, { filename: 'workbench/node-effects.js' });

const effectsApi = context.MelodySyncWorkbenchNodeEffects;
assert.ok(effectsApi, 'node effects api should be exposed on globalThis');
assert.equal(typeof effectsApi.getNodeKindEffect, 'function');
assert.equal(typeof effectsApi.buildQuestNodeCounts, 'function');

const mainEffect = effectsApi.getNodeKindEffect('main');
assert.equal(mainEffect.layoutVariant, 'root');
assert.equal(mainEffect.interaction, 'open-session');
assert.equal(mainEffect.countsAs.sessionNode, true);

const branchEffect = effectsApi.getNodeKindEffect('branch');
assert.equal(branchEffect.interaction, 'open-session');
assert.equal(branchEffect.countsAs.branch, true);

const candidateEffect = effectsApi.getNodeKindEffect('candidate');
assert.equal(candidateEffect.layoutVariant, 'compact');
assert.equal(candidateEffect.edgeVariant, 'suggestion');
assert.equal(candidateEffect.interaction, 'create-branch');
assert.equal(candidateEffect.trackAsCandidateChild, true);
assert.equal(candidateEffect.defaultSummary, '建议拆成独立支线');
assert.equal(candidateEffect.countsAs.sessionNode, false);
assert.equal(candidateEffect.countsAs.candidate, true);

const doneEffect = effectsApi.getNodeKindEffect('done');
assert.equal(doneEffect.layoutVariant, 'compact');
assert.equal(doneEffect.edgeVariant, 'completion');
assert.equal(doneEffect.interaction, 'none');
assert.equal(doneEffect.countsAs.completedSummary, true);

const hydratedCandidate = effectsApi.withNodeKindEffect({
  id: 'candidate:main-1:review',
  kind: 'candidate',
  title: '补充复盘支线',
});
assert.equal(hydratedCandidate.kindEffect.interaction, 'create-branch');

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
vm.runInNewContext(nodeEffectsSource, bootstrapContext, { filename: 'workbench/node-effects.js' });

const customEffect = bootstrapContext.MelodySyncWorkbenchNodeEffects.getNodeKindEffect('review');
assert.equal(customEffect.layoutVariant, 'compact');
assert.equal(customEffect.interaction, 'none');
assert.equal(customEffect.countsAs.sessionNode, false);
assert.equal(customEffect.edgeVariant, 'completion');
assert.equal(customEffect.countsAs.completedSummary, true);

console.log('test-workbench-node-effects: ok');
