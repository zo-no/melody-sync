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
const runtimeRoot = join(tempHome, '.melodysync', 'runtime');
const configDir = join(tempHome, '.config', 'melody-sync');

process.env.HOME = tempHome;
delete process.env.MELODYSYNC_CONFIG_DIR;
delete process.env.MELODYSYNC_MEMORY_DIR;
delete process.env.MELODYSYNC_INSTANCE_ROOT;
delete process.env.MELODYSYNC_OBSIDIAN_VAULT_DIR;
delete process.env.MELODYSYNC_OBSIDIAN_PATH;

mkdirSync(configDir, { recursive: true });
writeFileSync(join(configDir, 'general-settings.json'), JSON.stringify({ appRoot }, null, 2), 'utf8');

try {
  const { handleSettingsWriteRoutes } = await import(
    pathToFileURL(join(repoRoot, 'backend/controllers/settings/write-routes.mjs')).href
  );
  const { handleSettingsReadRoutes } = await import(
    pathToFileURL(join(repoRoot, 'backend/controllers/settings/read-routes.mjs')).href
  );

  const patchReq = Readable.from([JSON.stringify({
    mode: 'wake',
    wakePhrase: 'Hello Rowan',
    ttsEnabled: true,
    ttsVolume: 42,
    playbackVolume: 0.5,
  })]);
  patchReq.method = 'PATCH';
  const patchResult = {};
  const patchHandled = await handleSettingsWriteRoutes({
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
  assert.equal(patchResult.payload.simpleConfig.ttsVolume, 42);
  assert.equal(patchResult.payload.simpleConfig.playbackVolume, 0.5);
  assert.equal(patchResult.payload.config.wake.keyword, 'Hello Rowan');
  assert.equal(patchResult.payload.config.wake.command, 'bash scripts/voice/voice-managed-wake.sh');
  assert.equal(patchResult.payload.config.capture.command, 'bash scripts/voice/voice-managed-capture.sh');
  assert.equal(patchResult.payload.config.tts.mode, 'say');
  assert.equal(patchResult.payload.config.tts.env.XFYUN_VOLUME, '42');
  assert.equal(patchResult.payload.config.tts.env.COMPLETION_AFP_PLAY_VOLUME, '0.5');
  assert.equal(patchResult.payload.appRoot, appRoot);
  assert.equal(patchResult.payload.paths.configFile, join(runtimeRoot, 'voice', 'config.json'));

  const getResult = {};
  const getHandled = await handleSettingsReadRoutes({
    req: { method: 'GET' },
    res: {},
    pathname: '/api/settings/voice',
    writeJson(_res, status, payload) {
      getResult.status = status;
      getResult.payload = payload;
    },
    writeJsonCached(_req, _res, payload) {
      getResult.status = 200;
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
