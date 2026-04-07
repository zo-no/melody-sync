#!/usr/bin/env node
import assert from 'assert/strict';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const workflowState = await import(
  pathToFileURL(join(repoRoot, 'backend', 'session-workflow-state.mjs')).href
);

assert.equal(
  workflowState.didSessionWorkflowTransitionToDone('done', 'waiting_user'),
  true,
  'non-done to done should count as a completion transition',
);

assert.equal(
  workflowState.didSessionWorkflowTransitionToDone('completed', 'parked'),
  true,
  'done aliases should also count as a completion transition',
);

assert.equal(
  workflowState.didSessionWorkflowTransitionToDone('done', 'done'),
  false,
  'done to done should not retrigger completion delivery',
);

assert.equal(
  workflowState.didSessionWorkflowTransitionToDone('waiting_user', 'parked'),
  false,
  'non-done transitions should stay silent',
);

console.log('test-session-workflow-state-transitions: ok');
