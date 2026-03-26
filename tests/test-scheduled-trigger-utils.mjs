#!/usr/bin/env node
import assert from 'assert/strict';
import {
  computeNextIntervalRunAt,
  computeNextScheduledTriggerRunAt,
  getPrimaryScheduledTrigger,
  normalizeScheduledTrigger,
  normalizeScheduledTriggers,
} from '../chat/scheduled-trigger-utils.mjs';

const normalized = normalizeScheduledTrigger({
  enabled: true,
  timeOfDay: '09:30',
  timezone: 'Asia/Shanghai',
  content: 'Run morning planning',
});

assert.equal(normalized.enabled, true, 'enabled flag should persist');
assert.equal(normalized.timeOfDay, '09:30', 'time should be normalized');
assert.equal(normalized.timezone, 'Asia/Shanghai', 'timezone should persist when valid');
assert.equal(normalized.content, 'Run morning planning', 'content should be trimmed and preserved');
assert.ok(normalized.nextRunAt, 'enabled triggers should compute a next run');

const nextRun = computeNextScheduledTriggerRunAt(
  {
    enabled: true,
    timeOfDay: '09:30',
    timezone: 'Asia/Shanghai',
    content: 'Run morning planning',
  },
  Date.parse('2026-03-14T00:00:00.000Z'),
);
assert.equal(
  nextRun,
  '2026-03-14T01:30:00.000Z',
  'daily triggers should resolve the same-day run when the configured time is still ahead in the target timezone',
);

const tomorrowRun = computeNextScheduledTriggerRunAt(
  {
    enabled: true,
    timeOfDay: '09:30',
    timezone: 'Asia/Shanghai',
    content: 'Run morning planning',
  },
  Date.parse('2026-03-14T02:30:00.000Z'),
);
assert.equal(
  tomorrowRun,
  '2026-03-15T01:30:00.000Z',
  'daily triggers should roll to the next day after the configured time has passed',
);

const paused = normalizeScheduledTrigger({
  enabled: false,
  timeOfDay: '22:00',
  timezone: 'Asia/Shanghai',
  content: 'Run nightly review',
});
assert.ok(!paused.nextRunAt, 'paused triggers should not advertise a next run');

assert.equal(
  normalizeScheduledTrigger({
    enabled: true,
    timeOfDay: '25:99',
    timezone: 'Asia/Shanghai',
    content: 'invalid',
  }),
  null,
  'invalid times should be rejected',
);

assert.equal(
  computeNextIntervalRunAt(30, Date.parse('2026-03-14T00:00:00.000Z')),
  '2026-03-14T00:30:00.000Z',
  'interval triggers should schedule the next run relative to now when first created',
);

assert.equal(
  computeNextScheduledTriggerRunAt(
    {
      recurrenceType: 'interval',
      intervalMinutes: 30,
      content: 'Run hourly sync',
    },
    Date.parse('2026-03-14T01:05:00.000Z'),
    Date.parse('2026-03-14T01:00:00.000Z'),
  ),
  '2026-03-14T01:30:00.000Z',
  'interval triggers should advance from the previous slot without drifting',
);

const multiple = normalizeScheduledTriggers([
  {
    id: 'morning_plan',
    presetId: 'morning_plan',
    enabled: true,
    timeOfDay: '09:30',
    timezone: 'Asia/Shanghai',
    content: 'Run morning planning',
  },
  {
    id: 'night_review',
    enabled: false,
    recurrenceType: 'interval',
    intervalMinutes: 180,
    timeOfDay: '22:00',
    timezone: 'Asia/Shanghai',
    content: 'Run nightly review',
    model: 'sonnet',
  },
]);

assert.equal(multiple.length, 2, 'multiple triggers should normalize as a list');
assert.equal(multiple[0].id, 'morning_plan', 'trigger ids should persist');
assert.equal(multiple[0].presetId, 'morning_plan', 'preset ids should persist');
assert.equal(multiple[1].enabled, false, 'list entries should preserve enabled state');
assert.equal(multiple[1].recurrenceType, 'interval', 'interval triggers should preserve recurrence type');
assert.equal(multiple[1].intervalMinutes, 180, 'interval triggers should preserve interval minutes');
assert.equal(multiple[1].model, 'sonnet', 'trigger models should persist');
assert.equal(
  getPrimaryScheduledTrigger(multiple)?.id,
  'morning_plan',
  'primary trigger should prefer the next enabled item',
);

console.log('test-scheduled-trigger-utils: ok');
