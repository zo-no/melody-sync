#!/usr/bin/env node
/**
 * test-session-hooks.mjs
 * Verifies that all expected hooks are registered after server startup.
 */
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'hooks-test-'));

// Minimal config so session-manager can initialise
mkdirSync(join(tempHome, '.config', 'remotelab'), { recursive: true });
writeFileSync(
  join(tempHome, '.config', 'remotelab', 'tools.json'),
  JSON.stringify([{ id: 'fake', name: 'Fake', command: 'fake', runtimeFamily: 'codex-json' }]),
);

process.env.HOME = tempHome;

try {
  // Import hooks module first
  const { listHooks, HOOK_EVENTS, HOOK_EVENT_DEFINITIONS, applyHookEnabledOverrides } = await import(
    pathToFileURL(join(repoRoot, 'backend/hooks/index.mjs')).href
  );

  // Import session-manager — this registers module-level code but not
  // registerSessionManagerHooks yet (that's called in startDetachedRunObservers)
  const { startDetachedRunObservers, killAll } = await import(
    pathToFileURL(join(repoRoot, 'backend/session-manager.mjs')).href
  );

  // Trigger startup registration (same as chat-server.mjs does).
  // Run it twice to verify the registration path is idempotent.
  await startDetachedRunObservers();
  await startDetachedRunObservers();

  // ── Assertions ────────────────────────────────────────────────────────────

  // Events catalogue
  assert.deepEqual(
    [...HOOK_EVENTS].sort(),
    [
      'branch.merged',
      'branch.opened',
      'branch.suggested',
      'instance.first_boot',
      'instance.resume',
      'instance.startup',
      'run.completed',
      'run.failed',
      'run.started',
      'session.completed',
      'session.created',
      'session.first_user_message',
      'session.waiting_user',
    ],
    'HOOK_EVENTS should contain all supported lifecycle events',
  );
  assert.deepEqual(
    HOOK_EVENT_DEFINITIONS.map((definition) => definition.id),
    [
      'instance.first_boot',
      'instance.startup',
      'instance.resume',
      'session.created',
      'session.first_user_message',
      'session.waiting_user',
      'session.completed',
      'run.started',
      'run.completed',
      'run.failed',
      'branch.suggested',
      'branch.opened',
      'branch.merged',
    ],
    'HOOK_EVENT_DEFINITIONS should preserve the canonical event ordering',
  );
  assert.deepEqual(
    HOOK_EVENT_DEFINITIONS.map((definition) => definition.scope),
    [
      'instance',
      'instance',
      'instance',
      'session',
      'session',
      'session',
      'session',
      'run',
      'run',
      'run',
      'branch',
      'branch',
      'branch',
    ],
    'HOOK_EVENT_DEFINITIONS should expose the canonical lifecycle scopes',
  );
  assert.deepEqual(
    HOOK_EVENT_DEFINITIONS.map((definition) => definition.phase),
    [
      'startup',
      'startup',
      'startup',
      'entry',
      'entry',
      'closeout',
      'closeout',
      'execution',
      'closeout',
      'closeout',
      'closeout',
      'branch_followup',
      'branch_followup',
    ],
    'HOOK_EVENT_DEFINITIONS should expose the canonical lifecycle phases',
  );

  const hooks = listHooks();
  const hookIds = new Set(hooks.map((h) => h.id));

  const EXPECTED_HOOKS = [
    'builtin.first-boot-memory',
    'builtin.resume-completion-targets',
    'builtin.graph-context-bootstrap',
    'builtin.push-notification',
    'builtin.host-completion-voice',
    'builtin.email-completion',
    'builtin.branch-candidates',
    'builtin.session-naming',
  ];

  for (const id of EXPECTED_HOOKS) {
    assert.ok(hookIds.has(id), `Missing hook: ${id}`);
  }

  // No duplicates
  const idCounts = {};
  for (const h of hooks) idCounts[h.id] = (idCounts[h.id] || 0) + 1;
  for (const [id, count] of Object.entries(idCounts)) {
    assert.equal(count, 1, `Hook ${id} registered ${count} times (expected 1)`);
  }

  // Event pattern correctness
  const byId = Object.fromEntries(hooks.map((h) => [h.id, h]));
  assert.equal(byId['builtin.first-boot-memory'].eventPattern, 'instance.first_boot');
  assert.equal(byId['builtin.first-boot-memory'].scope, 'instance');
  assert.equal(byId['builtin.first-boot-memory'].phase, 'startup');
  assert.equal(byId['builtin.first-boot-memory'].taskMapPlanPolicy, 'none');
  assert.equal(byId['builtin.first-boot-memory'].producesTaskMapPlan, false);
  assert.equal(byId['builtin.resume-completion-targets'].eventPattern, 'instance.resume');
  assert.equal(byId['builtin.resume-completion-targets'].scope, 'instance');
  assert.equal(byId['builtin.resume-completion-targets'].phase, 'startup');
  assert.equal(byId['builtin.graph-context-bootstrap'].eventPattern, 'session.created');
  assert.equal(byId['builtin.graph-context-bootstrap'].scope, 'session');
  assert.equal(byId['builtin.graph-context-bootstrap'].phase, 'entry');
  assert.equal(byId['builtin.graph-context-bootstrap'].taskMapPlanPolicy, 'none');
  assert.equal(byId['builtin.graph-context-bootstrap'].producesTaskMapPlan, false);
  assert.equal(byId['builtin.graph-context-bootstrap'].promptContextPolicy, 'continuity');
  assert.equal(byId['builtin.graph-context-bootstrap'].producesPromptContext, true);
  assert.equal(byId['builtin.host-completion-voice'].eventPattern, 'run.completed');
  assert.equal(byId['builtin.host-completion-voice'].scope, 'run');
  assert.equal(byId['builtin.host-completion-voice'].phase, 'closeout');
  assert.equal(byId['builtin.branch-candidates'].eventPattern, 'branch.suggested');
  assert.equal(byId['builtin.branch-candidates'].scope, 'branch');
  assert.equal(byId['builtin.branch-candidates'].phase, 'closeout');
  assert.equal(byId['builtin.branch-candidates'].taskMapPlanPolicy, 'augment-default');
  assert.equal(byId['builtin.branch-candidates'].producesTaskMapPlan, true);
  assert.equal(byId['builtin.session-naming'].eventPattern, 'run.completed');
  assert.equal(byId['builtin.session-naming'].scope, 'run');
  assert.equal(byId['builtin.session-naming'].phase, 'closeout');
  assert.equal(byId['builtin.session-naming'].taskMapPlanPolicy, 'none');
  assert.equal(byId['builtin.session-naming'].producesTaskMapPlan, false);
  assert.equal(byId['builtin.first-boot-memory'].owner, 'hooks');
  assert.equal(byId['builtin.first-boot-memory'].sourceModule, 'backend/hooks/first-boot-memory-hook.mjs');
  assert.equal(byId['builtin.resume-completion-targets'].owner, 'hooks');
  assert.equal(byId['builtin.resume-completion-targets'].sourceModule, 'backend/hooks/resume-completion-targets-hook.mjs');
  assert.equal(byId['builtin.graph-context-bootstrap'].owner, 'hooks');
  assert.equal(byId['builtin.graph-context-bootstrap'].sourceModule, 'backend/hooks/graph-context-bootstrap-hook.mjs');
  assert.equal(byId['builtin.host-completion-voice'].owner, 'hooks');
  assert.equal(byId['builtin.host-completion-voice'].sourceModule, 'backend/hooks/host-completion-voice-hook.mjs');
  assert.equal(byId['builtin.push-notification'].owner, 'hooks');
  assert.equal(byId['builtin.push-notification'].sourceModule, 'backend/hooks/push-notification-hook.mjs');
  assert.equal(byId['builtin.branch-candidates'].owner, 'hooks');
  assert.equal(byId['builtin.branch-candidates'].sourceModule, 'backend/hooks/branch-candidates-hook.mjs');
  assert.equal(byId['builtin.session-naming'].owner, 'hooks');
  assert.equal(byId['builtin.session-naming'].sourceModule, 'backend/hooks/session-naming-hook.mjs');

  // All built-ins should be enabled by default.
  for (const h of hooks) {
    assert.equal(h.enabled, true, `Hook ${h.id} should be enabled by default`);
  }

  applyHookEnabledOverrides({
    'builtin.push-notification': false,
    'builtin.resume-completion-targets': false,
  });
  const overriddenHooks = Object.fromEntries(listHooks().map((hook) => [hook.id, hook]));
  assert.equal(overriddenHooks['builtin.push-notification']?.enabled, false, 'applyHookEnabledOverrides should update existing hook state');
  assert.equal(overriddenHooks['builtin.resume-completion-targets']?.enabled, false, 'applyHookEnabledOverrides should also apply to session-manager hooks');

  killAll();
  console.log('test-session-hooks: ok');
  console.log(`  ${hooks.length} hooks registered:`, hooks.map((h) => h.id).join(', '));
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
