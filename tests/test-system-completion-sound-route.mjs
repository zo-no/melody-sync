#!/usr/bin/env node
import assert from 'assert/strict';
import { Readable } from 'stream';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const { handleSystemWriteRoutes: handleSystemRoutes } = await import(
  pathToFileURL(join(repoRoot, 'backend/controllers/system/write-routes.mjs')).href
);

const baseParameters = {
  res: {},
  parsedUrl: { query: {} },
  buildAuthInfo() {
    return {};
  },
  writeJson(_res, status, payload) {
    this.status = status;
    this.payload = payload;
  },
  writeJsonCached() {
    throw new Error('writeJsonCached should not be used for completion sound route');
  },
  writeFileCached() {
    throw new Error('writeFileCached should not be used for completion sound route');
  },
  isDirectoryPath: async () => false,
  pathExists: async () => false,
  chatImagesDir: '',
  uploadedMediaMimeTypes: {},
};

const ownerResult = {};
const ownerHandled = await handleSystemRoutes({
  ...baseParameters,
  req: { method: 'POST' },
  pathname: '/api/system/completion-sound',
  getAuthSession: () => ({ role: 'owner' }),
  playHostCompletionSound: async () => ({ soundPath: '/System/Library/Sounds/Hero.aiff' }),
  writeJson(_res, status, payload) {
    ownerResult.status = status;
    ownerResult.payload = payload;
  },
});

assert.equal(ownerHandled, true);
assert.equal(ownerResult.status, 200);
assert.equal(ownerResult.payload.ok, true);
assert.equal(ownerResult.payload.mode, 'host');
assert.equal(ownerResult.payload.soundPath, '/System/Library/Sounds/Hero.aiff');

const customTextResult = {};
const customTextReq = Readable.from([Buffer.from(JSON.stringify({ speechText: 'Alpha，先确认导出结果。' }))]);
customTextReq.method = 'POST';
const customTextHandled = await handleSystemRoutes({
  ...baseParameters,
  req: customTextReq,
  pathname: '/api/system/completion-sound',
  getAuthSession: () => ({ role: 'owner' }),
  playHostCompletionSound: async (options) => {
    customTextResult.options = options;
    return { soundPath: '/System/Library/Sounds/Hero.aiff' };
  },
  writeJson(_res, status, payload) {
    customTextResult.status = status;
    customTextResult.payload = payload;
  },
});

assert.equal(customTextHandled, true);
assert.equal(customTextResult.status, 200);
assert.equal(customTextResult.options.speechText, 'Alpha，先确认导出结果。');

const visitorResult = {};
const visitorHandled = await handleSystemRoutes({
  ...baseParameters,
  req: { method: 'POST' },
  pathname: '/api/system/completion-sound',
  getAuthSession: () => ({ role: 'guest' }),
  playHostCompletionSound: async () => {
    throw new Error('should not be called for non-owner');
  },
  writeJson(_res, status, payload) {
    visitorResult.status = status;
    visitorResult.payload = payload;
  },
});

assert.equal(visitorHandled, true);
assert.equal(visitorResult.status, 403);
assert.equal(visitorResult.payload.error, 'Owner access required');

console.log('test-system-completion-sound-route: ok');
