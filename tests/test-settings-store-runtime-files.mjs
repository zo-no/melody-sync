#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-runtime-files-'));
const bootstrapConfigDir = join(tempHome, '.config', 'melody-sync');
const appRoot = join(tempHome, 'vault', '00-🤖agent');

process.env.HOME = tempHome;
delete process.env.REMOTELAB_CONFIG_DIR;
delete process.env.REMOTELAB_MEMORY_DIR;
delete process.env.REMOTELAB_INSTANCE_ROOT;
delete process.env.REMOTELAB_OBSIDIAN_VAULT_DIR;
delete process.env.REMOTELAB_OBSIDIAN_PATH;

mkdirSync(bootstrapConfigDir, { recursive: true });
writeFileSync(
  join(bootstrapConfigDir, 'general-settings.json'),
  JSON.stringify({ appRoot }, null, 2),
  'utf8',
);

try {
  const settingsStore = await import(pathToFileURL(join(repoRoot, 'chat/settings-store.mjs')).href);
  const runtime = await settingsStore.ensureGeneralSettingsRuntimeFiles();

  assert.equal(runtime.appRoot, appRoot);
  assert.equal(runtime.agentsPath, join(appRoot, 'AGENTS.md'));
  assert.equal(existsSync(join(appRoot, 'config')), true);
  assert.equal(existsSync(join(appRoot, 'email')), true);
  assert.equal(existsSync(join(appRoot, 'memory')), true);
  assert.equal(existsSync(join(appRoot, 'memory', 'tasks')), true);
  assert.equal(existsSync(join(appRoot, 'sessions')), true);
  assert.equal(existsSync(join(appRoot, 'hooks')), true);
  assert.equal(existsSync(join(appRoot, 'workbench')), true);
  assert.equal(existsSync(join(appRoot, 'logs')), true);
  assert.equal(existsSync(join(appRoot, 'AGENTS.md')), true);
  assert.equal(existsSync(join(appRoot, 'hooks', 'custom-hooks.json')), true);
  assert.match(readFileSync(join(appRoot, 'AGENTS.md'), 'utf8'), /MelodySync AGENTS/);
  assert.equal(readFileSync(join(appRoot, 'hooks', 'custom-hooks.json'), 'utf8'), '[]\n');

  console.log('test-settings-store-runtime-files: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
