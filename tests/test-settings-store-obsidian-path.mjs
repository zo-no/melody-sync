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

mkdirSync(legacyConfigDir, { recursive: true });
mkdirSync(firstVault, { recursive: true });
mkdirSync(secondVault, { recursive: true });
mkdirSync(join(firstVault, '00-🤖agent'), { recursive: true });
mkdirSync(join(secondVault, '00-🤖agent'), { recursive: true });

try {
  const settingsModule = await import(pathToFileURL(join(repoRoot, 'chat/settings-store.mjs')).href);

  const first = await settingsModule.persistGeneralSettings({ obsidianPath: firstVault });
  assert.equal(first.storageRootPath, firstVault);
  assert.equal(first.appRoot, join(firstVault, '00-🤖agent', '.melodysync'));
  assert.equal(first.storagePath, join(firstVault, '00-🤖agent', '.melodysync', 'config', 'general-settings.json'));
  assert.equal(first.bootstrapStoragePath, join(legacyConfigDir, 'general-settings.json'));
  assert.equal(first.customHooksPath, join(firstVault, '00-🤖agent', '.melodysync', 'hooks', 'custom-hooks.json'));
  assert.equal(first.agentsPath, join(firstVault, '00-🤖agent', 'AGENTS.md'));
  assert.equal(existsSync(first.storagePath), true);

  const second = await settingsModule.persistGeneralSettings({ obsidianPath: secondVault });
  assert.equal(second.storageRootPath, secondVault);
  assert.equal(second.appRoot, join(secondVault, '00-🤖agent', '.melodysync'));
  assert.equal(second.storagePath, join(secondVault, '00-🤖agent', '.melodysync', 'config', 'general-settings.json'));
  assert.equal(second.customHooksPath, join(secondVault, '00-🤖agent', '.melodysync', 'hooks', 'custom-hooks.json'));
  assert.equal(second.agentsPath, join(secondVault, '00-🤖agent', 'AGENTS.md'));
  assert.equal(
    JSON.parse(readFileSync(second.bootstrapStoragePath, 'utf8')).obsidianPath,
    secondVault,
    'bootstrap settings should always point at the latest configured path',
  );
  assert.equal(
    JSON.parse(readFileSync(second.storagePath, 'utf8')).obsidianPath,
    secondVault,
    'canonical settings should be written into the selected app root',
  );
  const current = await settingsModule.readGeneralSettings();
  assert.equal(current.storageRootPath, secondVault);
  assert.equal(current.appRoot, join(secondVault, '00-🤖agent', '.melodysync'));
  assert.equal(current.customHooksPath, join(secondVault, '00-🤖agent', '.melodysync', 'hooks', 'custom-hooks.json'));
  assert.equal(current.agentsPath, join(secondVault, '00-🤖agent', 'AGENTS.md'));

  console.log('test-settings-store-obsidian-path: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
