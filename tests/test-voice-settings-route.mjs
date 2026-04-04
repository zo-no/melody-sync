#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { Readable } from 'stream';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-voice-settings-route-'));
const appRoot = join(tempHome, 'vault', '00-🤖agent');
const configDir = join(tempHome, '.config', 'melody-sync');

process.env.HOME = tempHome;
delete process.env.REMOTELAB_CONFIG_DIR;
delete process.env.REMOTELAB_MEMORY_DIR;
delete process.env.REMOTELAB_INSTANCE_ROOT;
delete process.env.REMOTELAB_OBSIDIAN_VAULT_DIR;
delete process.env.REMOTELAB_OBSIDIAN_PATH;

mkdirSync(configDir, { recursive: true });
writeFileSync(join(configDir, 'general-settings.json'), JSON.stringify({ appRoot }, null, 2), 'utf8');

try {
  const { handleSettingsRoutes } = await import(
    pathToFileURL(join(repoRoot, 'backend', 'routes', 'settings.mjs')).href
  );

  const patchReq = Readable.from([JSON.stringify({
    mode: 'wake',
    wakePhrase: 'Hello Rowan',
    ttsEnabled: true,
  })]);
  patchReq.method = 'PATCH';
  const patchResult = {};
  const patchHandled = await handleSettingsRoutes({
    req: patchReq,
    res: {},
    pathname: '/api/settings/voice',
    writeJson(_res, status, payload) {
      patchResult.status = status;
      patchResult.payload = payload;
    },
  });

  assert.equal(patchHandled, true);
  assert.equal(patchResult.status, 200);
  assert.equal(patchResult.payload.simpleConfig.mode, 'wake');
  assert.equal(patchResult.payload.simpleConfig.wakePhrase, 'Hello Rowan');
  assert.equal(patchResult.payload.config.wake.keyword, 'Hello Rowan');
  assert.equal(patchResult.payload.config.wake.command, 'bash scripts/voice-managed-wake.sh');
  assert.equal(patchResult.payload.config.capture.command, 'bash scripts/voice-managed-capture.sh');
  assert.equal(patchResult.payload.config.tts.mode, 'say');
  assert.equal(patchResult.payload.paths.configFile, join(appRoot, 'voice', 'config.json'));

  const getResult = {};
  const getHandled = await handleSettingsRoutes({
    req: { method: 'GET' },
    res: {},
    pathname: '/api/settings/voice',
    writeJson(_res, status, payload) {
      getResult.status = status;
      getResult.payload = payload;
    },
  });

  assert.equal(getHandled, true);
  assert.equal(getResult.status, 200);
  assert.equal(getResult.payload.simpleConfig.mode, 'wake');
  assert.equal(getResult.payload.config.wake.keyword, 'Hello Rowan');

  console.log('test-voice-settings-route: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
