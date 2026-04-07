#!/usr/bin/env node
import assert from 'assert/strict';
import { isInvalidVapidSubscription } from '../backend/push.mjs';

assert.equal(
  isInvalidVapidSubscription({
    statusCode: 403,
    body: 'the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions.\n',
  }),
  true,
  '403 VAPID mismatch responses should be treated as stale subscriptions',
);

assert.equal(
  isInvalidVapidSubscription({
    statusCode: 403,
    body: 'permission denied',
  }),
  false,
  'unrelated 403 responses should not be treated as VAPID mismatches',
);

console.log('test-push-vapid-mismatch: ok');
