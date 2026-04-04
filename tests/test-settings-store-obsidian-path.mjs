#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-settings-obsidian-path-'));

process.env.HOME = tempHome;
delete process.env.REMOTELAB_CONFIG_DIR;
delete process.env.REMOTELAB_MEMORY_DIR;
delete process.env.REMOTELAB_INSTANCE_ROOT;
delete process.env.REMOTELAB_OBSIDIAN_VAULT_DIR;
delete process.env.REMOTELAB_OBSIDIAN_PATH;

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
  const settingsModule = await import(pathToFileURL(join(repoRoot, 'chat/settings-store.mjs')).href);

  const first = await settingsModule.persistGeneralSettings({ obsidianPath: firstAppRoot });
  assert.equal(first.configuredStorageRootPath, firstAppRoot);
  assert.equal(first.storageRootPath, firstAppRoot);
  assert.equal(first.appRoot, firstAppRoot);
  assert.equal(first.storagePath, join(firstAppRoot, 'config', 'general-settings.json'));
  assert.equal(first.bootstrapStoragePath, join(legacyConfigDir, 'general-settings.json'));
  assert.equal(first.customHooksPath, join(firstAppRoot, 'hooks', 'custom-hooks.json'));
  assert.equal(first.agentsPath, join(firstAppRoot, 'AGENTS.md'));
  assert.equal(existsSync(first.storagePath), true);

  const second = await settingsModule.persistGeneralSettings({ obsidianPath: secondAppRoot });
  assert.equal(second.configuredStorageRootPath, secondAppRoot);
  assert.equal(second.storageRootPath, secondAppRoot);
  assert.equal(second.appRoot, secondAppRoot);
  assert.equal(second.storagePath, join(secondAppRoot, 'config', 'general-settings.json'));
  assert.equal(second.customHooksPath, join(secondAppRoot, 'hooks', 'custom-hooks.json'));
  assert.equal(second.agentsPath, join(secondAppRoot, 'AGENTS.md'));
  assert.equal(
    JSON.parse(readFileSync(second.bootstrapStoragePath, 'utf8')).obsidianPath,
    secondAppRoot,
    'bootstrap settings should always point at the latest configured path',
  );
  assert.equal(
    JSON.parse(readFileSync(second.storagePath, 'utf8')).obsidianPath,
    secondAppRoot,
    'canonical settings should be written into the selected app root',
  );
  const current = await settingsModule.readGeneralSettings();
  assert.equal(current.configuredStorageRootPath, secondAppRoot);
  assert.equal(current.storageRootPath, secondAppRoot);
  assert.equal(current.appRoot, secondAppRoot);
  assert.equal(current.customHooksPath, join(secondAppRoot, 'hooks', 'custom-hooks.json'));
  assert.equal(current.agentsPath, join(secondAppRoot, 'AGENTS.md'));

  console.log('test-settings-store-obsidian-path: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
