#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const sessionHttpSource = readFileSync(join(repoRoot, 'static', 'frontend', 'session', 'http.js'), 'utf8');

function extractFunctionSource(code, functionName) {
  const marker = `function ${functionName}`;
  const start = code.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = code.indexOf('(', start);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < code.length; index += 1) {
    const char = code[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = code.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(bodyStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < code.length; index += 1) {
    const char = code[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(start, index + 1);
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

const normalizePushApplicationServerKeySource = extractFunctionSource(
  sessionHttpSource,
  'normalizePushApplicationServerKey',
);
const pushApplicationServerKeysMatchSource = extractFunctionSource(
  sessionHttpSource,
  'pushApplicationServerKeysMatch',
);

const context = {
  console,
  Uint8Array,
  ArrayBuffer,
};
context.globalThis = context;

vm.runInNewContext(`
  ${normalizePushApplicationServerKeySource}
  ${pushApplicationServerKeysMatchSource}
  globalThis.pushApplicationServerKeysMatch = pushApplicationServerKeysMatch;
`, context, {
  filename: 'static/frontend/session/http.js',
});

assert.equal(
  context.pushApplicationServerKeysMatch(
    { options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer } },
    new Uint8Array([1, 2, 3]),
  ),
  true,
  'matching application server keys should be preserved',
);

assert.equal(
  context.pushApplicationServerKeysMatch(
    { options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer } },
    new Uint8Array([3, 2, 1]),
  ),
  false,
  'mismatched application server keys should trigger re-subscription',
);

console.log('test-chat-push-subscription-rotation: ok');
