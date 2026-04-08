#!/usr/bin/env node
import assert from 'assert/strict';
import {
  emitLifecycleHooks,
  registerLifecycleHook,
  listHooks,
} from '../backend/hooks/runtime/registry.mjs';

const uniqueId = `test.lifecycle.${Date.now()}`;
let observedEvent = '';

registerLifecycleHook('session.started', async ({ event }) => {
  observedEvent = event;
}, {
  id: uniqueId,
  label: 'Lifecycle alias test',
});

const result = await emitLifecycleHooks('session.started', { sessionId: 'session-1' });

assert.equal(observedEvent, 'session.started', 'lifecycle alias should dispatch through the shared registry');
assert.equal(result.event, 'session.started');
assert.equal(result.hookCount >= 1, true);
assert.equal(
  listHooks().some((hook) => hook.id === uniqueId && hook.eventPattern === 'session.started'),
  true,
  'lifecycle alias should register hook metadata into the shared registry',
);

console.log('test-hooks-lifecycle-registry: ok');
