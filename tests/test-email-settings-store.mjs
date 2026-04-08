#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-email-settings-store-'));
const brainRoot = join(tempHome, 'vault', '00-🤖agent');
const runtimeRoot = join(tempHome, '.melodysync', 'runtime');
const configDir = join(tempHome, '.config', 'melody-sync');

process.env.HOME = tempHome;
delete process.env.MELODYSYNC_CONFIG_DIR;
delete process.env.MELODYSYNC_MEMORY_DIR;
delete process.env.MELODYSYNC_INSTANCE_ROOT;
delete process.env.MELODYSYNC_OBSIDIAN_VAULT_DIR;
delete process.env.MELODYSYNC_OBSIDIAN_PATH;

mkdirSync(configDir, { recursive: true });
writeFileSync(join(configDir, 'general-settings.json'), JSON.stringify({
  brainRoot,
  runtimeRoot,
}, null, 2), 'utf8');

try {
  const { readEmailSettings, persistEmailSettings } = await import(
    pathToFileURL(join(repoRoot, 'backend/settings/email-store.mjs')).href
  );

  const initial = await readEmailSettings();
  assert.equal(initial.emailRoot, join(runtimeRoot, 'email'));
  assert.equal(initial.paths.identityFile, join(runtimeRoot, 'email', 'identity.json'));
  assert.equal(initial.identity.address, '');
  assert.equal(initial.outbound.provider, 'apple_mail');
  assert.equal(initial.automation.chatBaseUrl, 'http://127.0.0.1:7760');

  const saved = await persistEmailSettings({
    identity: {
      name: 'Rowan',
      localPart: 'rowan',
      domain: 'example.com',
      instanceAddressMode: 'local_part',
    },
    allowlist: {
      allowedEmails: ['owner@example.com', 'owner@example.com'],
      allowedDomains: ['example.com', ' Example.com '],
    },
    outbound: {
      provider: 'apple_mail',
      account: 'Google',
      from: 'rowan@example.com',
    },
    automation: {
      enabled: true,
      allowlistAutoApprove: true,
      deliveryMode: 'session_only',
      chatBaseUrl: 'http://127.0.0.1:7761',
    },
  });

  assert.equal(saved.identity.address, 'rowan@example.com');
  assert.equal(saved.identity.instanceAddressMode, 'local_part');
  assert.deepEqual(saved.allowlist.allowedEmails, ['owner@example.com']);
  assert.deepEqual(saved.allowlist.allowedDomains, ['example.com']);
  assert.equal(saved.outbound.provider, 'apple_mail');
  assert.equal(saved.outbound.account, 'Google');
  assert.equal(saved.outbound.from, 'rowan@example.com');
  assert.equal(saved.automation.enabled, true);
  assert.equal(saved.automation.allowlistAutoApprove, true);
  assert.equal(saved.automation.deliveryMode, 'session_only');
  assert.equal(saved.automation.chatBaseUrl, 'http://127.0.0.1:7761');

  console.log('test-email-settings-store: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
