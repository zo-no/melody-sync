#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempRoot = mkdtempSync(join(tmpdir(), 'config-dotenv-'));

writeFileSync(
  join(tempRoot, '.env'),
  [
    'TEST_DOTENV_ONLY_ENV=from-env',
    'TEST_DOTENV_SHARED=from-env',
    'TEST_DOTENV_QUOTED="quoted value"',
    "TEST_DOTENV_SINGLE='single quoted value'",
  ].join('\n'),
);
writeFileSync(
  join(tempRoot, '.env.local'),
  [
    'TEST_DOTENV_SHARED=from-env-local',
    'TEST_DOTENV_ONLY_LOCAL=from-env-local',
  ].join('\n'),
);

const previous = {
  MELODYSYNC_SOURCE_PROJECT_ROOT: process.env.MELODYSYNC_SOURCE_PROJECT_ROOT,
  TEST_DOTENV_EXISTING: process.env.TEST_DOTENV_EXISTING,
  TEST_DOTENV_ONLY_ENV: process.env.TEST_DOTENV_ONLY_ENV,
  TEST_DOTENV_SHARED: process.env.TEST_DOTENV_SHARED,
  TEST_DOTENV_ONLY_LOCAL: process.env.TEST_DOTENV_ONLY_LOCAL,
  TEST_DOTENV_QUOTED: process.env.TEST_DOTENV_QUOTED,
  TEST_DOTENV_SINGLE: process.env.TEST_DOTENV_SINGLE,
};

process.env.MELODYSYNC_SOURCE_PROJECT_ROOT = tempRoot;
process.env.TEST_DOTENV_EXISTING = 'from-process';

try {
  await import(pathToFileURL(join(repoRoot, 'lib', 'config.mjs')).href);

  assert.equal(process.env.TEST_DOTENV_EXISTING, 'from-process');
  assert.equal(process.env.TEST_DOTENV_ONLY_ENV, 'from-env');
  assert.equal(process.env.TEST_DOTENV_SHARED, 'from-env-local');
  assert.equal(process.env.TEST_DOTENV_ONLY_LOCAL, 'from-env-local');
  assert.equal(process.env.TEST_DOTENV_QUOTED, 'quoted value');
  assert.equal(process.env.TEST_DOTENV_SINGLE, 'single quoted value');

  console.log('test-config-dotenv-loading: ok');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
