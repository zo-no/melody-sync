#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-default-legacy-migration-'));
const legacyAppRoot = join(tempHome, '.melodysync');

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

writeLegacyFile(
  join(legacyAppRoot, 'config', 'auth.json'),
  JSON.stringify({ token: 'legacy-token', username: 'zono' }, null, 2),
);
writeLegacyFile(
  join(legacyAppRoot, 'config', 'auth-sessions.json'),
  JSON.stringify({ session_1: { expiry: 123 } }, null, 2),
);
writeLegacyFile(
  join(legacyAppRoot, 'config', 'push-subscriptions.json'),
  JSON.stringify([{ endpoint: 'https://example.com/push' }], null, 2),
);
writeLegacyFile(
  join(legacyAppRoot, 'config', 'ui-runtime-selection.json'),
  JSON.stringify({ tool: 'codex' }, null, 2),
);
writeLegacyFile(
  join(legacyAppRoot, 'config', 'general-settings.json'),
  JSON.stringify({ completionSoundEnabled: false }, null, 2),
);
writeLegacyFile(
  join(legacyAppRoot, 'config', 'provider-runtime-homes', 'codex', 'sessions', '2026', '04', '09', 'legacy.jsonl'),
  '{"kind":"provider-session"}\n',
);
writeLegacyFile(
  join(legacyAppRoot, 'sessions', 'chat-sessions.json'),
  JSON.stringify([{ id: 'legacy-session', name: 'Legacy Session' }], null, 2),
);
writeLegacyFile(
  join(legacyAppRoot, 'sessions', 'history', 'legacy-session', 'meta.json'),
  JSON.stringify({ id: 'legacy-session', name: 'Legacy Session' }, null, 2),
);
writeLegacyFile(
  join(legacyAppRoot, 'sessions', 'history', 'legacy-session', 'events', '000000001.json'),
  JSON.stringify({ type: 'message', text: 'legacy event' }, null, 2),
);
writeLegacyFile(join(legacyAppRoot, 'email', 'identity.json'), JSON.stringify({ name: 'Legacy Mailbox' }, null, 2));
writeLegacyFile(join(legacyAppRoot, 'hooks', 'custom-hooks.json'), '[]\n');
writeLegacyFile(join(legacyAppRoot, 'voice', 'config.json'), JSON.stringify({ connectorId: 'legacy-voice' }, null, 2));
writeLegacyFile(join(legacyAppRoot, 'workbench', 'legacy-node.json'), '{"id":"legacy-node"}\n');
writeLegacyFile(join(legacyAppRoot, 'logs', 'api', 'legacy.jsonl'), '{"path":"legacy"}\n');

try {
  const config = await import(pathToFileURL(join(repoRoot, 'lib/config.mjs')).href);

  assert.equal(config.MELODYSYNC_APP_ROOT, legacyAppRoot);
  assert.equal(config.MELODYSYNC_RUNTIME_ROOT, join(legacyAppRoot, 'runtime'));
  assert.equal(config.CONFIG_DIR, join(tempHome, '.config', 'melody-sync'));

  assert.deepEqual(
    JSON.parse(readFileSync(config.AUTH_FILE, 'utf8')),
    { token: 'legacy-token', username: 'zono' },
    'legacy machine auth config should be copied into the new machine config dir',
  );
  assert.deepEqual(
    JSON.parse(readFileSync(config.AUTH_SESSIONS_FILE, 'utf8')),
    { session_1: { expiry: 123 } },
    'legacy auth sessions should be copied into the new machine config dir',
  );
  assert.deepEqual(
    JSON.parse(readFileSync(config.PUSH_SUBSCRIPTIONS_FILE, 'utf8')),
    [{ endpoint: 'https://example.com/push' }],
    'legacy push subscriptions should be copied into the new machine config dir',
  );
  assert.deepEqual(
    JSON.parse(readFileSync(config.UI_RUNTIME_SELECTION_FILE, 'utf8')),
    { tool: 'codex' },
    'legacy runtime selection should be copied into the new machine config dir',
  );
  assert.equal(
    JSON.parse(readFileSync(config.GENERAL_SETTINGS_FILE, 'utf8')).completionSoundEnabled,
    false,
    'legacy app-scoped settings should be copied into the runtime config dir',
  );
  assert.equal(
    existsSync(join(config.MELODYSYNC_RUNTIME_ROOT, 'config', 'provider-runtime-homes', 'codex', 'sessions', '2026', '04', '09', 'legacy.jsonl')),
    true,
    'legacy provider runtime homes should be copied into the runtime config dir',
  );
  assert.equal(
    JSON.parse(readFileSync(config.CHAT_SESSIONS_FILE, 'utf8'))[0].id,
    'legacy-session',
    'legacy session catalog should be copied into the runtime sessions dir',
  );
  assert.equal(
    JSON.parse(readFileSync(join(config.CHAT_HISTORY_DIR, 'legacy-session', 'meta.json'), 'utf8')).id,
    'legacy-session',
    'legacy session history metadata should be copied into the runtime history dir',
  );
  assert.equal(
    JSON.parse(readFileSync(join(config.CHAT_HISTORY_DIR, 'legacy-session', 'events', '000000001.json'), 'utf8')).text,
    'legacy event',
    'legacy session event files should be copied into the runtime history dir',
  );
  assert.equal(
    JSON.parse(readFileSync(join(config.MELODYSYNC_RUNTIME_ROOT, 'email', 'identity.json'), 'utf8')).name,
    'Legacy Mailbox',
    'legacy email state should be copied into the runtime root',
  );
  assert.equal(
    JSON.parse(readFileSync(join(config.MELODYSYNC_RUNTIME_ROOT, 'voice', 'config.json'), 'utf8')).connectorId,
    'legacy-voice',
    'legacy voice state should be copied into the runtime root',
  );
  assert.equal(
    readFileSync(join(config.MELODYSYNC_RUNTIME_ROOT, 'workbench', 'legacy-node.json'), 'utf8'),
    '{"id":"legacy-node"}\n',
    'legacy workbench state should be copied into the runtime root',
  );
  assert.equal(
    readFileSync(join(config.MELODYSYNC_RUNTIME_ROOT, 'logs', 'api', 'legacy.jsonl'), 'utf8'),
    '{"path":"legacy"}\n',
    'legacy runtime logs should be copied into the runtime root',
  );
  assert.equal(
    existsSync(join(legacyAppRoot, 'sessions', 'chat-sessions.json')),
    true,
    'legacy source files should remain in place after copy-based migration',
  );

  console.log('test-config-default-app-root-legacy-migration: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
