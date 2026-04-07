#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-obsidian-app-root-'));

process.env.HOME = tempHome;
delete process.env.MELODYSYNC_CONFIG_DIR;
delete process.env.MELODYSYNC_MEMORY_DIR;
delete process.env.MELODYSYNC_INSTANCE_ROOT;
delete process.env.MELODYSYNC_OBSIDIAN_VAULT_DIR;
delete process.env.MELODYSYNC_OBSIDIAN_PATH;

const legacyConfigDir = join(tempHome, '.config', 'melody-sync');
const vaultPath = join(tempHome, 'vault');
const preferredAgentDir = join(vaultPath, '00-🤖agent');
const defaultRuntimeRoot = join(tempHome, '.melodysync', 'runtime');
const legacyNestedAppRoot = join(preferredAgentDir, '.melodysync');
const legacyVaultConfigDir = join(legacyNestedAppRoot, 'config');
const legacyVaultHooksDir = join(legacyNestedAppRoot, 'hooks');
const legacyVaultSessionsDir = join(legacyNestedAppRoot, 'sessions');
const legacyMemoryDir = join(legacyNestedAppRoot, 'memory');

mkdirSync(legacyConfigDir, { recursive: true });
mkdirSync(vaultPath, { recursive: true });
mkdirSync(preferredAgentDir, { recursive: true });
mkdirSync(legacyVaultConfigDir, { recursive: true });
mkdirSync(legacyVaultHooksDir, { recursive: true });
mkdirSync(legacyVaultSessionsDir, { recursive: true });
mkdirSync(legacyMemoryDir, { recursive: true });

writeFileSync(
  join(legacyConfigDir, 'general-settings.json'),
  JSON.stringify({ appRoot: preferredAgentDir }, null, 2),
  'utf8',
);
writeFileSync(
  join(legacyVaultHooksDir, 'settings.json'),
  JSON.stringify({ enabledById: { 'builtin.push-notification': false } }, null, 2),
  'utf8',
);
writeFileSync(
  join(legacyVaultSessionsDir, 'chat-sessions.json'),
  JSON.stringify([{ id: 'session-1', label: 'Demo' }], null, 2),
  'utf8',
);
writeFileSync(join(legacyMemoryDir, 'bootstrap.md'), '# Legacy bootstrap\n', 'utf8');

try {
  const config = await import(pathToFileURL(join(repoRoot, 'lib/config.mjs')).href);

  assert.equal(config.USE_OBSIDIAN_VAULT_STORAGE, true);
  assert.equal(config.OBSIDIAN_VAULT_DIR, preferredAgentDir);
  assert.equal(config.MELODYSYNC_BRAIN_ROOT, preferredAgentDir);
  assert.equal(config.MELODYSYNC_RUNTIME_ROOT, defaultRuntimeRoot);
  assert.equal(config.MELODYSYNC_APP_ROOT, preferredAgentDir);
  assert.equal(config.CONFIG_DIR, legacyConfigDir);
  assert.equal(config.MEMORY_DIR, join(preferredAgentDir, 'memory'));
  assert.equal(config.HOOKS_FILE, join(defaultRuntimeRoot, 'hooks', 'settings.json'));
  assert.equal(config.CHAT_SESSIONS_FILE, join(defaultRuntimeRoot, 'sessions', 'chat-sessions.json'));
  assert.equal(config.CUSTOM_HOOKS_FILE, join(defaultRuntimeRoot, 'hooks', 'custom-hooks.json'));
  assert.equal(config.MELODYSYNC_AGENTS_FILE, join(preferredAgentDir, 'AGENTS.md'));

  assert.equal(existsSync(join(preferredAgentDir, 'README.md')), true, 'app root README should be scaffolded');
  assert.equal(existsSync(config.MELODYSYNC_AGENTS_FILE), true, 'agents guide scaffold should exist');
  assert.equal(existsSync(config.CUSTOM_HOOKS_FILE), true, 'custom hooks scaffold should exist');
  assert.deepEqual(
    JSON.parse(readFileSync(config.HOOKS_FILE, 'utf8')),
    { enabledById: { 'builtin.push-notification': false } },
    'legacy hook settings should be copied into the app root',
  );
  assert.deepEqual(
    JSON.parse(readFileSync(config.CHAT_SESSIONS_FILE, 'utf8')),
    [{ id: 'session-1', label: 'Demo' }],
    'legacy session metadata should be copied into the app root',
  );
  assert.equal(
    readFileSync(join(config.MEMORY_DIR, 'bootstrap.md'), 'utf8'),
    '# Legacy bootstrap\n',
    'legacy memory should be copied into the app root',
  );

  console.log('test-config-obsidian-app-root: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
