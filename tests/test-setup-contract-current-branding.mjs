#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';

const content = readFileSync(new URL('../docs/setup.md', import.meta.url), 'utf8');

assert.match(content, /# MelodySync Local Setup Contract/);
assert.match(content, /raw\.githubusercontent\.com\/zo-no\/melody-sync\/main\/docs\/setup\.md/);
assert.match(content, /github\.com\/zo-no\/melody-sync\.git/);
assert.match(content, /127\.0\.0\.1:7760/);
assert.match(content, /EXTERNAL_ACCESS\.md/);
assert.doesNotMatch(content, /Ninglo\/remotelab/);
assert.doesNotMatch(content, /~\/code\/remotelab/);
assert.doesNotMatch(content, /:7690/);
assert.doesNotMatch(content, /Network mode:/);
assert.doesNotMatch(content, /cloudflare \| tailscale/i);

console.log('test-setup-contract-current-branding: ok');
