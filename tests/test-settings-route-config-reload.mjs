#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { Readable } from 'stream';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-settings-route-'));

process.env.HOME = tempHome;
delete process.env.MELODYSYNC_CONFIG_DIR;
delete process.env.MELODYSYNC_MEMORY_DIR;
delete process.env.MELODYSYNC_INSTANCE_ROOT;
delete process.env.MELODYSYNC_OBSIDIAN_VAULT_DIR;
delete process.env.MELODYSYNC_OBSIDIAN_PATH;

const configDir = join(tempHome, '.config', 'melody-sync');
const firstAppRoot = join(tempHome, 'vault-a', '00-🤖agent');
const secondAppRoot = join(tempHome, 'vault-b', '00-🤖agent');
const secondRuntimeRoot = join(tempHome, '.melodysync', 'runtime-b');

mkdirSync(configDir, { recursive: true });
mkdirSync(firstAppRoot, { recursive: true });
mkdirSync(secondAppRoot, { recursive: true });
writeFileSync(
  join(configDir, 'general-settings.json'),
  JSON.stringify({ appRoot: firstAppRoot }, null, 2),
  'utf8',
);

try {
  const { handleSettingsRoutes } = await import(
    pathToFileURL(join(repoRoot, 'backend/routes/settings.mjs')).href
  );

  const req = Readable.from([JSON.stringify({ brainRoot: secondAppRoot, runtimeRoot: secondRuntimeRoot })]);
  req.method = 'PATCH';
  const result = {};
  const handled = await handleSettingsRoutes({
    req,
    res: {},
    pathname: '/api/settings',
    scheduleConfigReload() {
      result.reloadScheduled = true;
      return true;
    },
    writeJson(_res, status, payload) {
      result.status = status;
      result.payload = payload;
    },
  });

  assert.equal(handled, true);
  assert.equal(result.status, 200);
  assert.equal(result.payload.brainRoot, secondAppRoot);
  assert.equal(result.payload.runtimeRoot, secondRuntimeRoot);
  assert.equal(result.payload.appRoot, secondAppRoot);
  assert.equal(result.payload.reloadRequired, true);
  assert.equal(result.payload.reloadScheduled, true);

  console.log('test-settings-route-config-reload: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
