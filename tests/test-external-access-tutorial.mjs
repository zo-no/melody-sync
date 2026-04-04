#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';

const content = readFileSync(new URL('../EXTERNAL_ACCESS.md', import.meta.url), 'utf8');

assert.match(content, /MelodySync External Access/);
assert.match(content, /Server Reverse Proxy/);
assert.match(content, /Cloudflare Tunnel/);
assert.match(content, /Tailscale/);
assert.match(content, /127\.0\.0\.1:7760/);
assert.match(content, /MelodySync itself only manages the local chat service/);

console.log('test-external-access-tutorial: ok');
