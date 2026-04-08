#!/usr/bin/env node
import assert from 'assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-custom-hooks-'));

process.env.HOME = tempHome;
delete process.env.MELODYSYNC_CONFIG_DIR;
delete process.env.MELODYSYNC_MEMORY_DIR;
delete process.env.MELODYSYNC_INSTANCE_ROOT;
delete process.env.MELODYSYNC_OBSIDIAN_VAULT_DIR;
delete process.env.MELODYSYNC_OBSIDIAN_PATH;

const configDir = join(tempHome, '.config', 'melody-sync');
const vaultPath = join(tempHome, 'vault', '00-🤖agent');
const runtimeHooksDir = join(tempHome, '.melodysync', 'runtime', 'hooks');
const outputPath = join(tempHome, 'hook-output.txt');

mkdirSync(configDir, { recursive: true });
mkdirSync(runtimeHooksDir, { recursive: true });
writeFileSync(
  join(configDir, 'general-settings.json'),
  JSON.stringify({ appRoot: vaultPath }, null, 2),
  'utf8',
);
writeFileSync(
  join(runtimeHooksDir, 'custom-hooks.json'),
  JSON.stringify([
    {
      id: 'custom.open-obsidian-script',
      eventPattern: 'instance.startup',
      label: '打开 Obsidian',
      description: '测试用自定义本地脚本 hook。',
      shellCommand: `printf '%s' \"$MELODYSYNC_APP_ROOT\" > \"${outputPath}\"`,
      runInBackground: false,
    },
  ], null, 2),
  'utf8',
);

try {
  const { registerCustomHooks } = await import(
    pathToFileURL(join(repoRoot, 'backend/hooks/runtime/register-custom-hooks.mjs')).href
  );
  const { listHooks, emit } = await import(
    pathToFileURL(join(repoRoot, 'backend/hooks/runtime/registry.mjs')).href
  );

  await registerCustomHooks();
  const hooks = Object.fromEntries(listHooks().map((hook) => [hook.id, hook]));
  assert.equal(hooks['custom.open-obsidian-script']?.eventPattern, 'instance.startup');
  assert.equal(hooks['custom.open-obsidian-script']?.owner, 'custom-hooks');
  assert.equal(hooks['custom.open-obsidian-script']?.enabled, true);

  await emit('instance.startup', {
    sessionId: '',
    session: null,
    manifest: null,
  });

  assert.equal(existsSync(outputPath), true, 'custom hook script should run on its configured event');
  assert.equal(
    readFileSync(outputPath, 'utf8'),
    vaultPath,
    'custom hook script should receive the configured storage root path',
  );

  console.log('test-custom-hooks-runtime: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
