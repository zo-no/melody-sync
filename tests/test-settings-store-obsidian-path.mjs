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

mkdirSync(legacyConfigDir, { recursive: true });
mkdirSync(firstVault, { recursive: true });
mkdirSync(secondVault, { recursive: true });
mkdirSync(firstAppRoot, { recursive: true });
mkdirSync(secondAppRoot, { recursive: true });

try {
  const settingsModule = await import(pathToFileURL(join(repoRoot, 'backend/settings-store.mjs')).href);

  const first = await settingsModule.persistGeneralSettings({ appRoot: firstAppRoot });
  assert.equal(first.configuredAppRootPath, firstAppRoot);
  assert.equal(first.appRoot, firstAppRoot);
  assert.equal(first.completionSoundEnabled, true);
  assert.equal(first.storagePath, join(firstAppRoot, 'config', 'general-settings.json'));
  assert.equal(first.bootstrapStoragePath, join(legacyConfigDir, 'general-settings.json'));
  assert.equal(first.customHooksPath, join(firstAppRoot, 'hooks', 'custom-hooks.json'));
  assert.equal(first.agentsPath, join(firstAppRoot, 'AGENTS.md'));
  assert.equal(existsSync(first.storagePath), true);

  const second = await settingsModule.persistGeneralSettings({ appRoot: secondAppRoot });
  assert.equal(second.configuredAppRootPath, secondAppRoot);
  assert.equal(second.appRoot, secondAppRoot);
  assert.equal(second.completionSoundEnabled, true);
  assert.equal(second.storagePath, join(secondAppRoot, 'config', 'general-settings.json'));
  assert.equal(second.customHooksPath, join(secondAppRoot, 'hooks', 'custom-hooks.json'));
  assert.equal(second.agentsPath, join(secondAppRoot, 'AGENTS.md'));
  assert.equal(
    JSON.parse(readFileSync(second.bootstrapStoragePath, 'utf8')).appRoot,
    secondAppRoot,
    'bootstrap settings should always point at the latest configured path',
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
      agentsPath: '/Users/other-machine/Shared/Vault/00-🤖agent/AGENTS.md',
    }, null, 2),
    'utf8',
  );
  const current = await settingsModule.readGeneralSettings();
  assert.equal(current.configuredAppRootPath, secondAppRoot);
  assert.equal(current.appRoot, secondAppRoot);
  assert.equal(current.completionSoundEnabled, true, 'unknown app-local keys should not disable completion sounds by default');
  assert.equal(current.customHooksPath, join(secondAppRoot, 'hooks', 'custom-hooks.json'));
  assert.equal(current.agentsPath, join(secondAppRoot, 'AGENTS.md'));

  console.log('test-settings-store-obsidian-path: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
