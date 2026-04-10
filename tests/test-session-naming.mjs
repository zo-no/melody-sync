#!/usr/bin/env node
import assert from 'assert/strict';
import {
  formatSessionOrdinalBadge,
  formatSessionOrdinalSpeechLabel,
  normalizeGeneratedSessionTitle,
} from '../backend/session/naming.mjs';

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

assert.equal(
  normalizeGeneratedSessionTitle('Refactor the naming flow for session auto rename and shorten the sidebar labels', 'MelodySync'),
  'Refactor the naming flow for',
  'auto-generated session titles should be clipped before being stored',
);

assert.equal(
  normalizeGeneratedSessionTitle('自动命名标题过长啦', ''),
  '自动命名标题',
  'Chinese auto-generated session titles should be capped at six characters',
);

assert.equal(formatSessionOrdinalBadge(12), '#12');
assert.equal(formatSessionOrdinalSpeechLabel(12), '任务12');

console.log('test-session-naming: ok');
