#!/usr/bin/env node
import assert from 'assert/strict';
import { buildPostAuthLocation } from '../backend/controllers/public/auth-routes.mjs';

assert.equal(
  buildPostAuthLocation({ query: { token: 'abc', session: 'sess-1', tab: 'sessions' } }, '/'),
  '/?session=sess-1&tab=sessions',
  'token bootstrap should preserve the original landing query while stripping the auth token',
);

assert.equal(
  buildPostAuthLocation({ query: { token: 'abc' } }, '/'),
  '/',
  'token bootstrap should fall back to the root app entry when no other landing params exist',
);

assert.equal(
  buildPostAuthLocation({ query: { token: 'abc', session: 'sess-1' } }, '/login'),
  '/?session=sess-1',
  'login-path token bootstrap should normalize back to the owner app shell while preserving landing params',
);

console.log('test-auth-token-redirect: ok');
