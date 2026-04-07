#!/usr/bin/env node
import assert from 'assert/strict';
import { URL } from 'url';

import {
  buildXfyunAuthUrl,
  isXfyunAvailable,
} from '../backend/xfyun-completion-tts.mjs';

{
  const { authUrl } = buildXfyunAuthUrl({
    appId: 'test-app',
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    host: 'tts-api.xfyun.cn',
    path: '/v2/tts',
  });
  const parsed = new URL(authUrl);
  assert.equal(parsed.host, 'tts-api.xfyun.cn');
  assert.ok(parsed.searchParams.has('authorization'), 'auth url should include authorization');
  assert.equal(parsed.searchParams.get('host'), 'tts-api.xfyun.cn');
  assert.equal(parsed.searchParams.has('date'), true);
  assert.equal(parsed.pathname, '/v2/tts');
}

{
  assert.equal(isXfyunAvailable({ appId: 'a', apiKey: 'b', apiSecret: 'c' }), true);
  assert.equal(isXfyunAvailable({ appId: '', apiKey: 'b', apiSecret: 'c' }), false);
  assert.equal(isXfyunAvailable({ appId: 'a', apiKey: '', apiSecret: 'c' }), false);
}

console.log('test-xfyun-completion-tts: ok');
