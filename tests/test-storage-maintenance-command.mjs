#!/usr/bin/env node
import assert from 'assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-storage-maint-'));
const bootstrapConfigDir = join(tempHome, '.config', 'melody-sync');
const appRoot = join(tempHome, 'vault', '00-🤖agent');
const nowIso = '2026-04-07T12:00:00.000Z';
const oldDate = new Date('2026-03-20T12:00:00.000Z');
const recentDate = new Date('2026-04-06T12:00:00.000Z');

process.env.HOME = tempHome;
delete process.env.MELODYSYNC_CONFIG_DIR;
delete process.env.MELODYSYNC_MEMORY_DIR;
delete process.env.MELODYSYNC_INSTANCE_ROOT;
delete process.env.MELODYSYNC_OBSIDIAN_VAULT_DIR;
delete process.env.MELODYSYNC_OBSIDIAN_PATH;

mkdirSync(bootstrapConfigDir, { recursive: true });
writeFileSync(
  join(bootstrapConfigDir, 'general-settings.json'),
  JSON.stringify({ appRoot }, null, 2),
  'utf8',
);

function writeFile(pathname, content, mtime = recentDate) {
  mkdirSync(dirname(pathname), { recursive: true });
  writeFileSync(pathname, content, 'utf8');
  utimesSync(pathname, mtime, mtime);
}

const oldApiLog = join(appRoot, 'logs', 'api', '2026-03-20.jsonl');
const recentApiLog = join(appRoot, 'logs', 'api', '2026-04-06.jsonl');

const oldRunDir = join(appRoot, 'sessions', 'runs', 'run_old');
const recentRunDir = join(appRoot, 'sessions', 'runs', 'run_recent');
const activeRunDir = join(appRoot, 'sessions', 'runs', 'run_active');

const oldProviderSession = join(
  appRoot,
  'config',
  'provider-runtime-homes',
  'codex',
  'sessions',
  '2026',
  '03',
  '20',
  'rollout-old.jsonl',
);
const recentProviderSession = join(
  appRoot,
  'config',
  'provider-runtime-homes',
  'codex',
  'sessions',
  '2026',
  '04',
  '06',
  'rollout-recent.jsonl',
);
const oldShellSnapshot = join(
  appRoot,
  'config',
  'provider-runtime-homes',
  'codex',
  'shell_snapshots',
  'old.sh',
);
const recentShellSnapshot = join(
  appRoot,
  'config',
  'provider-runtime-homes',
  'codex',
  'shell_snapshots',
  'recent.sh',
);

writeFile(oldApiLog, '{"path":"old"}\n', oldDate);
writeFile(recentApiLog, '{"path":"recent"}\n', recentDate);

writeFile(join(oldRunDir, 'status.json'), JSON.stringify({
  id: 'run_old',
  state: 'completed',
  completedAt: '2026-03-20T12:00:00.000Z',
  updatedAt: '2026-03-20T12:00:00.000Z',
}, null, 2), oldDate);
writeFile(join(oldRunDir, 'manifest.json'), JSON.stringify({ id: 'run_old' }, null, 2), oldDate);
writeFile(join(oldRunDir, 'result.json'), JSON.stringify({ ok: true }, null, 2), oldDate);
writeFile(join(oldRunDir, 'spool.jsonl'), '{"line":"old spool"}\n', oldDate);
writeFile(join(oldRunDir, 'artifacts', 'aggregated_output.txt'), 'old artifact', oldDate);

writeFile(join(recentRunDir, 'status.json'), JSON.stringify({
  id: 'run_recent',
  state: 'completed',
  completedAt: '2026-04-06T12:00:00.000Z',
  updatedAt: '2026-04-06T12:00:00.000Z',
}, null, 2), recentDate);
writeFile(join(recentRunDir, 'manifest.json'), JSON.stringify({ id: 'run_recent' }, null, 2), recentDate);
writeFile(join(recentRunDir, 'spool.jsonl'), '{"line":"recent spool"}\n', recentDate);
writeFile(join(recentRunDir, 'artifacts', 'aggregated_output.txt'), 'recent artifact', recentDate);

writeFile(join(activeRunDir, 'status.json'), JSON.stringify({
  id: 'run_active',
  state: 'running',
  updatedAt: '2026-03-20T12:00:00.000Z',
}, null, 2), oldDate);
writeFile(join(activeRunDir, 'manifest.json'), JSON.stringify({ id: 'run_active' }, null, 2), oldDate);
writeFile(join(activeRunDir, 'spool.jsonl'), '{"line":"active spool"}\n', oldDate);

writeFile(oldProviderSession, '{"session":"old"}\n', oldDate);
writeFile(recentProviderSession, '{"session":"recent"}\n', recentDate);
writeFile(oldShellSnapshot, 'echo old\n', oldDate);
writeFile(recentShellSnapshot, 'echo recent\n', recentDate);

const { runStorageMaintenanceCommand } = await import(
  pathToFileURL(join(repoRoot, 'lib', 'storage-maintenance-command.mjs')).href
);

try {
  let output = '';
  const stdout = { write(chunk) { output += chunk; } };
  const dryRunExitCode = await runStorageMaintenanceCommand(
    ['--json', '--now', nowIso],
    { stdout },
  );
  assert.equal(dryRunExitCode, 0, 'dry run should exit cleanly');
  const dryRun = JSON.parse(output);
  assert.equal(dryRun.plan.totalCandidates, 5, 'should report only old reclaimable paths');
  const runPayloads = dryRun.plan.categories.find((category) => category.key === 'run_payloads');
  assert.equal(runPayloads.itemCount, 2, 'old terminal run should expose spool and artifacts');
  assert.equal(runPayloads.runCount, 1, 'only one old terminal run should qualify');
  const apiLogs = dryRun.plan.categories.find((category) => category.key === 'api_logs');
  assert.equal(apiLogs.itemCount, 1, 'only old api log should qualify');
  const providerSessions = dryRun.plan.categories.find((category) => category.key === 'provider_sessions');
  assert.equal(providerSessions.itemCount, 1, 'only old provider session should qualify');
  const shellSnapshots = dryRun.plan.categories.find((category) => category.key === 'provider_shell_snapshots');
  assert.equal(shellSnapshots.itemCount, 1, 'only old shell snapshot should qualify');

  output = '';
  const applyExitCode = await runStorageMaintenanceCommand(
    ['--json', '--apply', '--now', nowIso],
    { stdout: { write(chunk) { output += chunk; } } },
  );
  assert.equal(applyExitCode, 0, 'apply should exit cleanly');
  const applied = JSON.parse(output);
  assert.equal(applied.result.removedCount, 5, 'apply should delete all dry-run candidates');
  assert.equal(applied.result.failedCount, 0, 'apply should not report failures');

  assert.equal(existsSync(oldApiLog), false, 'old api log should be deleted');
  assert.equal(existsSync(recentApiLog), true, 'recent api log should remain');

  assert.equal(existsSync(join(oldRunDir, 'spool.jsonl')), false, 'old run spool should be deleted');
  assert.equal(existsSync(join(oldRunDir, 'artifacts')), false, 'old run artifacts should be deleted');
  assert.equal(existsSync(join(oldRunDir, 'status.json')), true, 'old run status should remain');
  assert.equal(existsSync(join(oldRunDir, 'manifest.json')), true, 'old run manifest should remain');
  assert.equal(existsSync(join(oldRunDir, 'result.json')), true, 'old run result should remain');
  assert.deepEqual(JSON.parse(readFileSync(join(oldRunDir, 'status.json'), 'utf8')).state, 'completed');

  assert.equal(existsSync(join(recentRunDir, 'spool.jsonl')), true, 'recent run spool should remain');
  assert.equal(existsSync(join(recentRunDir, 'artifacts')), true, 'recent run artifacts should remain');
  assert.equal(existsSync(join(activeRunDir, 'spool.jsonl')), true, 'active run spool should remain');

  assert.equal(existsSync(oldProviderSession), false, 'old managed provider session should be deleted');
  assert.equal(existsSync(recentProviderSession), true, 'recent managed provider session should remain');
  assert.equal(existsSync(oldShellSnapshot), false, 'old shell snapshot should be deleted');
  assert.equal(existsSync(recentShellSnapshot), true, 'recent shell snapshot should remain');

  console.log('test-storage-maintenance-command: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
