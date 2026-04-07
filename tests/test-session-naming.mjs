#!/usr/bin/env node
import assert from 'assert/strict';
import { normalizeGeneratedSessionTitle } from '../backend/session-naming.mjs';

assert.equal(
  normalizeGeneratedSessionTitle('MelodySync Rename Flow', 'MelodySync'),
  'Rename Flow',
  'AI titles should drop a repeated leading group name',
);

assert.equal(
  normalizeGeneratedSessionTitle('Rename Flow — MelodySync', 'MelodySync'),
  'Rename Flow',
  'AI titles should drop a repeated trailing group name',
);

assert.equal(
  normalizeGeneratedSessionTitle('招聘 JD 优化', '招聘'),
  'JD 优化',
  'AI titles should also drop repeated leading group text in Chinese',
);

assert.equal(
  normalizeGeneratedSessionTitle('Fix auth bug', 'MelodySync'),
  'Fix auth bug',
  'specific titles should stay unchanged when they do not repeat the group',
);

assert.equal(
  normalizeGeneratedSessionTitle('MelodySync', 'MelodySync'),
  'MelodySync',
  'empty results should fall back to the original title',
);

console.log('test-session-naming: ok');
