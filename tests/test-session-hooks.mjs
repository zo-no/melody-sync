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
  const { listHooks, HOOK_EVENTS } = await import(
    pathToFileURL(join(repoRoot, 'chat/session-hooks.mjs')).href
  );

  // Import session-manager — this registers module-level code but not
  // registerSessionManagerHooks yet (that's called in startDetachedRunObservers)
  const { startDetachedRunObservers, killAll } = await import(
    pathToFileURL(join(repoRoot, 'chat/session-manager.mjs')).href
  );

  // Trigger startup registration (same as chat-server.mjs does).
  // Run it twice to verify the registration path is idempotent.
  await startDetachedRunObservers();
  await startDetachedRunObservers();

  // ── Assertions ────────────────────────────────────────────────────────────

  // Events catalogue
  assert.deepEqual(
    [...HOOK_EVENTS].sort(),
    ['run.completed', 'run.failed', 'run.started', 'session.created'],
    'HOOK_EVENTS should contain all 4 lifecycle events',
  );

  const hooks = listHooks();
  const hookIds = new Set(hooks.map((h) => h.id));

  const EXPECTED_HOOKS = [
    'builtin.push-notification',
    'builtin.email-completion',
    'builtin.workbench-sync',
    'builtin.workbench-sync-on-fail',
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
  assert.equal(byId['builtin.branch-candidates'].eventPattern, 'run.completed');
  assert.equal(byId['builtin.session-naming'].eventPattern, 'run.completed');
  assert.equal(byId['builtin.workbench-sync'].eventPattern, 'run.completed');
  assert.equal(byId['builtin.workbench-sync-on-fail'].eventPattern, 'run.failed');

  // All built-ins should be enabled by default
  for (const h of hooks) {
    assert.equal(h.enabled, true, `Hook ${h.id} should be enabled by default`);
  }

  killAll();
  console.log('test-session-hooks: ok');
  console.log(`  ${hooks.length} hooks registered:`, hooks.map((h) => h.id).join(', '));
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
