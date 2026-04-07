#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-legacy-runtime-migration-'));
const bootstrapConfigDir = join(tempHome, '.config', 'melody-sync');
const appRoot = join(tempHome, 'vault', '00-🤖agent');
const runtimeRoot = join(tempHome, '.melodysync', 'runtime');

process.env.HOME = tempHome;
delete process.env.MELODYSYNC_CONFIG_DIR;
delete process.env.MELODYSYNC_MEMORY_DIR;
delete process.env.MELODYSYNC_INSTANCE_ROOT;
delete process.env.MELODYSYNC_OBSIDIAN_VAULT_DIR;
delete process.env.MELODYSYNC_OBSIDIAN_PATH;

function writeLegacyFile(pathname, content) {
  mkdirSync(dirname(pathname), { recursive: true });
  writeFileSync(pathname, content, 'utf8');
}

mkdirSync(bootstrapConfigDir, { recursive: true });
writeFileSync(
  join(bootstrapConfigDir, 'general-settings.json'),
  JSON.stringify({ appRoot }, null, 2),
  'utf8',
);

writeLegacyFile(join(appRoot, 'config', 'general-settings.json'), JSON.stringify({
  completionSoundEnabled: false,
}, null, 2));
writeLegacyFile(
  join(appRoot, 'config', 'provider-runtime-homes', 'codex', 'sessions', '2026', '04', '07', 'legacy.jsonl'),
  '{"kind":"legacy-provider-session"}\n',
);
writeLegacyFile(join(appRoot, 'email', 'identity.json'), JSON.stringify({
  name: 'Legacy Mailbox',
}, null, 2));
writeLegacyFile(join(appRoot, 'voice', 'config.json'), JSON.stringify({
  connectorId: 'legacy-voice',
}, null, 2));
writeLegacyFile(join(appRoot, 'sessions', 'chat-sessions.json'), JSON.stringify([
  { id: 'legacy-session', name: 'Legacy Session' },
], null, 2));
writeLegacyFile(join(appRoot, 'hooks', 'legacy-hook.txt'), 'legacy hook\n');
writeLegacyFile(join(appRoot, 'workbench', 'legacy-node.json'), '{"id":"legacy-node"}\n');
writeLegacyFile(join(appRoot, 'logs', 'api', 'legacy.jsonl'), '{"path":"legacy"}\n');

try {
  const settingsStore = await import(pathToFileURL(join(repoRoot, 'backend/settings-store.mjs')).href);
  const runtime = await settingsStore.ensureGeneralSettingsRuntimeFiles();

  assert.equal(runtime.brainRoot, appRoot);
  assert.equal(runtime.runtimeRoot, runtimeRoot);

  assert.equal(
    JSON.parse(readFileSync(join(runtimeRoot, 'config', 'general-settings.json'), 'utf8')).completionSoundEnabled,
    false,
    'legacy app-scoped settings should be copied into the runtime config dir',
  );
  assert.equal(
    existsSync(join(runtimeRoot, 'config', 'provider-runtime-homes', 'codex', 'sessions', '2026', '04', '07', 'legacy.jsonl')),
    true,
    'legacy provider runtime homes should be copied into the runtime root',
  );
  assert.equal(
    JSON.parse(readFileSync(join(runtimeRoot, 'email', 'identity.json'), 'utf8')).name,
    'Legacy Mailbox',
    'legacy email state should be copied into the runtime root',
  );
  assert.equal(
    JSON.parse(readFileSync(join(runtimeRoot, 'voice', 'config.json'), 'utf8')).connectorId,
    'legacy-voice',
    'legacy voice state should be copied into the runtime root',
  );
  assert.equal(
    JSON.parse(readFileSync(join(runtimeRoot, 'sessions', 'chat-sessions.json'), 'utf8'))[0].id,
    'legacy-session',
    'legacy sessions should be copied into the runtime root',
  );
  assert.equal(
    readFileSync(join(runtimeRoot, 'hooks', 'legacy-hook.txt'), 'utf8'),
    'legacy hook\n',
    'legacy hooks should be copied into the runtime root',
  );
  assert.equal(
    readFileSync(join(runtimeRoot, 'workbench', 'legacy-node.json'), 'utf8'),
    '{"id":"legacy-node"}\n',
    'legacy workbench files should be copied into the runtime root',
  );
  assert.equal(
    readFileSync(join(runtimeRoot, 'logs', 'api', 'legacy.jsonl'), 'utf8'),
    '{"path":"legacy"}\n',
    'legacy runtime logs should be copied into the runtime root',
  );

  assert.equal(
    existsSync(join(appRoot, 'email', 'identity.json')),
    true,
    'legacy source files should remain in place after copy-based migration',
  );

  console.log('test-settings-store-legacy-runtime-migration: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
