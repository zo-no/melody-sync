#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-settings-obsidian-path-'));

process.env.HOME = tempHome;
delete process.env.MELODYSYNC_CONFIG_DIR;
delete process.env.MELODYSYNC_MEMORY_DIR;
delete process.env.MELODYSYNC_INSTANCE_ROOT;
delete process.env.MELODYSYNC_OBSIDIAN_VAULT_DIR;
delete process.env.MELODYSYNC_OBSIDIAN_PATH;

const legacyConfigDir = join(tempHome, '.config', 'melody-sync');
const firstVault = join(tempHome, 'vault-a');
const secondVault = join(tempHome, 'vault-b');
const firstAppRoot = join(firstVault, '00-🤖agent');
const secondAppRoot = join(secondVault, '00-🤖agent');
const defaultRuntimeRoot = join(tempHome, '.melodysync', 'runtime');

mkdirSync(legacyConfigDir, { recursive: true });
mkdirSync(firstVault, { recursive: true });
mkdirSync(secondVault, { recursive: true });
mkdirSync(firstAppRoot, { recursive: true });
mkdirSync(secondAppRoot, { recursive: true });

try {
  const settingsModule = await import(pathToFileURL(join(repoRoot, 'backend/settings-store.mjs')).href);

  const first = await settingsModule.persistGeneralSettings({ appRoot: firstAppRoot });
  assert.equal(first.configuredBrainRootPath, firstAppRoot);
  assert.equal(first.configuredRuntimeRootPath, '');
  assert.equal(first.configuredAppRootPath, firstAppRoot);
  assert.equal(first.brainRoot, firstAppRoot);
  assert.equal(first.runtimeRoot, defaultRuntimeRoot);
  assert.equal(first.appRoot, firstAppRoot);
  assert.equal(first.completionSoundEnabled, true);
  assert.equal(first.storagePath, join(defaultRuntimeRoot, 'config', 'general-settings.json'));
  assert.equal(first.bootstrapStoragePath, join(legacyConfigDir, 'general-settings.json'));
  assert.equal(first.customHooksPath, join(defaultRuntimeRoot, 'hooks', 'custom-hooks.json'));
  assert.equal(first.agentsPath, join(firstAppRoot, 'AGENTS.md'));
  assert.equal(existsSync(first.storagePath), true);

  const second = await settingsModule.persistGeneralSettings({ appRoot: secondAppRoot });
  assert.equal(second.configuredBrainRootPath, secondAppRoot);
  assert.equal(second.configuredRuntimeRootPath, '');
  assert.equal(second.configuredAppRootPath, secondAppRoot);
  assert.equal(second.brainRoot, secondAppRoot);
  assert.equal(second.runtimeRoot, defaultRuntimeRoot);
  assert.equal(second.appRoot, secondAppRoot);
  assert.equal(second.completionSoundEnabled, true);
  assert.equal(second.storagePath, join(defaultRuntimeRoot, 'config', 'general-settings.json'));
  assert.equal(second.customHooksPath, join(defaultRuntimeRoot, 'hooks', 'custom-hooks.json'));
  assert.equal(second.agentsPath, join(secondAppRoot, 'AGENTS.md'));
  assert.equal(
    JSON.parse(readFileSync(second.bootstrapStoragePath, 'utf8')).brainRoot,
    secondAppRoot,
    'bootstrap settings should persist the latest configured brain root',
  );
  assert.equal(
    JSON.parse(readFileSync(second.bootstrapStoragePath, 'utf8')).runtimeRoot,
    defaultRuntimeRoot,
    'bootstrap settings should persist the resolved runtime root once split storage is enabled',
  );
  assert.equal(
    JSON.stringify(JSON.parse(readFileSync(second.storagePath, 'utf8'))),
    JSON.stringify({}),
    'app-local settings should not persist machine-specific app root pointers',
  );

  const toggled = await settingsModule.persistGeneralSettings({
    appRoot: secondAppRoot,
    completionSoundEnabled: false,
  });
  assert.equal(toggled.completionSoundEnabled, false);
  assert.equal(
    JSON.stringify(JSON.parse(readFileSync(second.storagePath, 'utf8'))),
    JSON.stringify({ completionSoundEnabled: false }),
    'app-local settings should persist completion sound preference when overridden',
  );

  writeFileSync(
    second.storagePath,
    JSON.stringify({
      appRoot: '/Users/other-machine/Shared/Vault/00-🤖agent',
      brainRoot: '/Users/other-machine/Shared/Vault/00-🤖agent',
      runtimeRoot: '/Users/other-machine/.melodysync/runtime',
      agentsPath: '/Users/other-machine/Shared/Vault/00-🤖agent/AGENTS.md',
    }, null, 2),
    'utf8',
  );
  const current = await settingsModule.readGeneralSettings();
  assert.equal(current.configuredBrainRootPath, secondAppRoot);
  assert.equal(current.configuredRuntimeRootPath, defaultRuntimeRoot);
  assert.equal(current.configuredAppRootPath, secondAppRoot);
  assert.equal(current.brainRoot, secondAppRoot);
  assert.equal(current.runtimeRoot, defaultRuntimeRoot);
  assert.equal(current.appRoot, secondAppRoot);
  assert.equal(current.completionSoundEnabled, true, 'unknown app-local keys should not disable completion sounds by default');
  assert.equal(current.customHooksPath, join(defaultRuntimeRoot, 'hooks', 'custom-hooks.json'));
  assert.equal(current.agentsPath, join(secondAppRoot, 'AGENTS.md'));

  console.log('test-settings-store-obsidian-path: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
