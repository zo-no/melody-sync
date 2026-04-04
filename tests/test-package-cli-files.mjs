#!/usr/bin/env node
import assert from 'assert/strict';
import { execFileSync } from 'child_process';

const output = execFileSync('npm', ['pack', '--json', '--dry-run'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});

const [packInfo] = JSON.parse(output);
const packagedPaths = new Set((packInfo.files || []).map((entry) => entry.path));

for (const expectedPath of [
  'cli.js',
  'setup.sh',
  'start.sh',
  'stop.sh',
  'restart.sh',
  'generate-token.mjs',
  'set-password.mjs',
  'EXTERNAL_ACCESS.md',
]) {
  assert.ok(
    packagedPaths.has(expectedPath),
    `published package should include ${expectedPath}`,
  );
}

console.log('test-package-cli-files: ok');
