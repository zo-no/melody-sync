#!/usr/bin/env node
import assert from 'assert/strict';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const moduleUrl = pathToFileURL(
  join(repoRoot, 'backend', 'services', 'session', 'http-message-service.mjs'),
).href;

const moduleExports = await import(moduleUrl);

assert.equal(typeof moduleExports.submitSessionHttpMessageForClient, 'function');

console.log('test-http-message-service-import: ok');
