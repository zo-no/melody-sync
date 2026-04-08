#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'hook-settings-'));

mkdirSync(join(tempHome, '.config', 'melody-sync'), { recursive: true });
writeFileSync(
  join(tempHome, '.config', 'melody-sync', 'tools.json'),
  JSON.stringify([{ id: 'fake', name: 'Fake', command: 'fake', runtimeFamily: 'codex-json' }]),
);

process.env.HOME = tempHome;

try {
  const hooksModule = await import(pathToFileURL(join(repoRoot, 'backend/hooks/index.mjs')).href);
  const { registerSessionManagerBuiltinHooks } = await import(
    pathToFileURL(join(repoRoot, 'backend/hooks/runtime/register-session-manager-hooks.mjs')).href
  );
  const { loadPersistedHookSettings, persistHookEnabledState, readHookSettings } = await import(
    pathToFileURL(join(repoRoot, 'backend/hooks/runtime/settings-store.mjs')).href
  );

  registerSessionManagerBuiltinHooks({
    appendEvents: async () => {},
    isSessionAutoRenamePending: () => false,
    triggerAutomaticSessionLabeling: async () => {},
    resumePendingCompletionTargets: async () => {},
  });

  await persistHookEnabledState('builtin.push-notification', false);
  await persistHookEnabledState('builtin.resume-completion-targets', false);
  await loadPersistedHookSettings();

  const byId = Object.fromEntries(hooksModule.listHooks().map((hook) => [hook.id, hook]));
  assert.equal(byId['builtin.push-notification']?.enabled, false, 'persisted settings should rehydrate repo hooks');
  assert.equal(byId['builtin.resume-completion-targets']?.enabled, false, 'persisted settings should rehydrate session-manager hooks');

  const stored = await readHookSettings();
  assert.deepEqual(stored.enabledById, {
    'builtin.push-notification': false,
    'builtin.resume-completion-targets': false,
  });

  console.log('test-hook-settings-store: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
