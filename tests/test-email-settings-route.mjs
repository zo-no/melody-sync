#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { Readable } from 'stream';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-email-settings-route-'));
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
    identity: {
      name: 'Rowan',
      localPart: 'rowan',
      domain: 'example.com',
    },
    outbound: {
      provider: 'apple_mail',
      account: 'Google',
      from: 'rowan@example.com',
    },
    automation: {
      enabled: true,
      allowlistAutoApprove: false,
      deliveryMode: 'reply_email',
      chatBaseUrl: 'http://127.0.0.1:7760',
    },
  })]);
  patchReq.method = 'PATCH';
  const patchResult = {};
  const patchHandled = await handleSettingsWriteRoutes({
    req: patchReq,
    res: {},
    pathname: '/api/settings/email',
    writeJson(_res, status, payload) {
      patchResult.status = status;
      patchResult.payload = payload;
    },
  });

  assert.equal(patchHandled, true);
  assert.equal(patchResult.status, 200);
  assert.equal(patchResult.payload.identity.address, 'rowan@example.com');
  assert.equal(patchResult.payload.outbound.provider, 'apple_mail');
  assert.equal(patchResult.payload.outbound.account, 'Google');
  assert.equal(patchResult.payload.outbound.from, 'rowan@example.com');
  assert.equal(patchResult.payload.appRoot, appRoot);
  assert.equal(patchResult.payload.paths.outboundFile, join(runtimeRoot, 'email', 'outbound.json'));

  const getResult = {};
  const getHandled = await handleSettingsReadRoutes({
    req: { method: 'GET' },
    res: {},
    pathname: '/api/settings/email',
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
  assert.equal(getResult.payload.identity.address, 'rowan@example.com');
  assert.equal(getResult.payload.outbound.provider, 'apple_mail');

  console.log('test-email-settings-route: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
