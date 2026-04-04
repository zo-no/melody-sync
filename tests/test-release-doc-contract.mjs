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
  'EXTERNAL_ACCESS.md',
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
assert.match(setupContent, /EXTERNAL_ACCESS\.md/);
assert.doesNotMatch(setupContent, /Ninglo\/remotelab/);
assert.doesNotMatch(setupContent, /~\/code\/remotelab/);
assert.doesNotMatch(setupContent, /:7690/);
assert.doesNotMatch(setupContent, /Network mode:/);
assert.doesNotMatch(setupContent, /cloudflare \| tailscale/i);

const externalAccessContent = readFileSync(new URL('../EXTERNAL_ACCESS.md', import.meta.url), 'utf8');
assert.match(externalAccessContent, /MelodySync External Access/);
assert.match(externalAccessContent, /Server Reverse Proxy/);
assert.match(externalAccessContent, /Cloudflare Tunnel/);
assert.match(externalAccessContent, /Tailscale/);
assert.match(externalAccessContent, /127\.0\.0\.1:7760/);
assert.match(externalAccessContent, /MelodySync itself only manages the local chat service/);

console.log('test-release-doc-contract: ok');
