#!/usr/bin/env node
import assert from 'assert/strict';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

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
]) {
  assert.ok(
    packagedPaths.has(expectedPath),
    `published package should include ${expectedPath}`,
  );
}

const setupContent = readFileSync(new URL('../docs/setup.md', import.meta.url), 'utf8');
assert.match(setupContent, /# MelodySync Local Setup Contract/);
assert.match(setupContent, /raw\.githubusercontent\.com\/zo-no\/melody-sync\/main\/docs\/setup\.md/);
assert.match(setupContent, /github\.com\/zo-no\/melody-sync\.git/);
assert.match(setupContent, /127\.0\.0\.1:7760/);
assert.doesNotMatch(setupContent, /EXTERNAL_ACCESS\.md/);
assert.doesNotMatch(setupContent, /github\.com\/Ninglo\//);
assert.doesNotMatch(setupContent, /~\/code\/remote/);
assert.doesNotMatch(setupContent, /:7690/);
assert.doesNotMatch(setupContent, /Network mode:/);
assert.doesNotMatch(setupContent, /cloudflare \| tailscale/i);

console.log('test-release-doc-contract: ok');
