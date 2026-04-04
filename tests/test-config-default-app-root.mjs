#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-default-app-root-'));

process.env.HOME = tempHome;
delete process.env.REMOTELAB_CONFIG_DIR;
delete process.env.REMOTELAB_MEMORY_DIR;
delete process.env.REMOTELAB_INSTANCE_ROOT;
delete process.env.REMOTELAB_OBSIDIAN_VAULT_DIR;
delete process.env.REMOTELAB_OBSIDIAN_PATH;

try {
  const config = await import(pathToFileURL(join(repoRoot, 'lib/config.mjs')).href);

  assert.equal(config.USE_APP_ROOT_STORAGE, true);
  assert.equal(config.USE_OBSIDIAN_VAULT_STORAGE, false);
  assert.equal(config.MELODYSYNC_APP_ROOT, join(tempHome, '.melodysync'));
  assert.equal(config.CONFIG_DIR, join(tempHome, '.melodysync', 'config'));
  assert.equal(config.MEMORY_DIR, join(tempHome, '.melodysync', 'memory'));
  assert.equal(config.MELODYSYNC_AGENTS_FILE, join(tempHome, '.melodysync', 'AGENTS.md'));
  assert.equal(existsSync(join(tempHome, '.melodysync', 'hooks', 'custom-hooks.json')), true);

  console.log('test-config-default-app-root: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
