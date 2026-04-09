#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-settings-task-list-groups-'));

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
  const settingsService = await import(
    pathToFileURL(join(repoRoot, 'backend/services/settings/http-service.mjs')).href
  );

  const first = await settingsService.updateGeneralSettingsForClient({
    taskListTemplateGroups: ['  研究任务  ', 'Bug 修复', '研究任务', '', '待确认'],
  });
  assert.deepEqual(
    first.taskListTemplateGroups,
    ['研究任务', 'Bug 修复', '待确认'],
    'template groups should be trimmed, deduplicated, and persisted',
  );

  const second = await settingsService.updateGeneralSettingsForClient({
    brainRoot: secondAppRoot,
    runtimeRoot: secondRuntimeRoot,
  });
  assert.deepEqual(
    second.taskListTemplateGroups,
    ['研究任务', 'Bug 修复', '待确认'],
    'template groups should survive unrelated general settings updates',
  );

  const loaded = await settingsService.getGeneralSettingsForClient();
  assert.deepEqual(
    loaded.taskListTemplateGroups,
    ['研究任务', 'Bug 修复', '待确认'],
    'general settings reads should expose the persisted template groups',
  );

  console.log('test-settings-task-list-template-groups: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
