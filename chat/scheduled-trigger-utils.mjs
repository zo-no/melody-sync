import { randomBytes } from 'crypto';

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SCHEDULED_TRIGGER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SCHEDULED_TRIGGER_RECURRENCE_TYPES = new Set(['daily', 'interval']);
const SCHEDULED_TRIGGER_PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function extractIsoString(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function getResolvedTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function getFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getZonedParts(ms, timeZone) {
  const formatter = getFormatter(timeZone);
  const parts = formatter.formatToParts(new Date(ms));
  const lookup = Object.create(null);
  for (const part of parts) {
    if (part.type !== 'literal') lookup[part.type] = part.value;
  }
  return {
    year: Number.parseInt(lookup.year || '', 10),
    month: Number.parseInt(lookup.month || '', 10),
    day: Number.parseInt(lookup.day || '', 10),
    hour: Number.parseInt(lookup.hour || '', 10),
    minute: Number.parseInt(lookup.minute || '', 10),
    second: Number.parseInt(lookup.second || '', 10),
  };
}

function getTimeZoneOffsetMs(timeZone, utcMs) {
  const parts = getZonedParts(utcMs, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - utcMs;
}

function zonedDateTimeToUtcMs({ year, month, day, hour, minute }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstOffset = getTimeZoneOffsetMs(timeZone, guess);
  const candidate = guess - firstOffset;
  const secondOffset = getTimeZoneOffsetMs(timeZone, candidate);
  if (secondOffset === firstOffset) return candidate;
  return guess - secondOffset;
}

function addDaysToDateParts({ year, month, day }, days = 1) {
  const utcMs = Date.UTC(year, month - 1, day + days, 0, 0, 0, 0);
  const next = new Date(utcMs);
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function createScheduledTriggerId() {
  return `st_${randomBytes(6).toString('hex')}`;
}

export function normalizeScheduledTriggerId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || !SCHEDULED_TRIGGER_ID_PATTERN.test(text)) return '';
  return text;
}

export function normalizeScheduledTriggerPresetId(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!text || !SCHEDULED_TRIGGER_PRESET_ID_PATTERN.test(text)) return '';
  return text;
}

export function normalizeScheduledTriggerTimeOfDay(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = text.match(TIME_OF_DAY_PATTERN);
  return match ? `${match[1]}:${match[2]}` : '';
}

export function isValidScheduledTriggerTimeZone(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return false;
  try {
    getFormatter(text).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function normalizeScheduledTriggerTimeZone(value, fallback = getResolvedTimeZone()) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (isValidScheduledTriggerTimeZone(text)) return text;
  return isValidScheduledTriggerTimeZone(fallback) ? fallback : 'UTC';
}

export function normalizeScheduledTriggerRecurrenceType(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SCHEDULED_TRIGGER_RECURRENCE_TYPES.has(text) ? text : 'daily';
}

export function normalizeScheduledTriggerIntervalMinutes(value) {
  const numeric = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 10080) return 0;
  return numeric;
}

export function computeNextDailyRunAt(timeOfDay, timeZone, fromMs = Date.now()) {
  const normalizedTime = normalizeScheduledTriggerTimeOfDay(timeOfDay);
  if (!normalizedTime) return '';
  const zone = normalizeScheduledTriggerTimeZone(timeZone);
  const [hourText, minuteText] = normalizedTime.split(':');
  const hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);
  const zonedNow = getZonedParts(fromMs, zone);
  const todayCandidateMs = zonedDateTimeToUtcMs({
    year: zonedNow.year,
    month: zonedNow.month,
    day: zonedNow.day,
    hour,
    minute,
  }, zone);
  const nextCandidateMs = todayCandidateMs > fromMs
    ? todayCandidateMs
    : zonedDateTimeToUtcMs({
      ...addDaysToDateParts(zonedNow, 1),
      hour,
      minute,
    }, zone);
  return new Date(nextCandidateMs).toISOString();
}

export function computeNextIntervalRunAt(intervalMinutes, fromMs = Date.now(), anchorMs = null) {
  const normalizedIntervalMinutes = normalizeScheduledTriggerIntervalMinutes(intervalMinutes);
  if (!normalizedIntervalMinutes) return '';
  const intervalMs = normalizedIntervalMinutes * 60 * 1000;
  let nextMs = Number.isFinite(anchorMs) ? anchorMs : (fromMs + intervalMs);
  while (nextMs <= fromMs) {
    nextMs += intervalMs;
  }
  return new Date(nextMs).toISOString();
}

export function normalizeStoredScheduledTrigger(rawTrigger, {
  fallbackTimeZone = getResolvedTimeZone(),
  nowMs = Date.now(),
} = {}) {
  if (!rawTrigger || typeof rawTrigger !== 'object' || Array.isArray(rawTrigger)) {
    return null;
  }

  const recurrenceType = normalizeScheduledTriggerRecurrenceType(rawTrigger.recurrenceType);
  const timeOfDay = normalizeScheduledTriggerTimeOfDay(rawTrigger.timeOfDay);
  const intervalMinutes = normalizeScheduledTriggerIntervalMinutes(rawTrigger.intervalMinutes);
  const promptSource = typeof rawTrigger.prompt === 'string' && rawTrigger.prompt.trim()
    ? rawTrigger.prompt
    : rawTrigger.content;
  const prompt = typeof promptSource === 'string' ? promptSource.trim() : '';
  if (!prompt) return null;
  if (recurrenceType === 'daily' && !timeOfDay) return null;
  if (recurrenceType === 'interval' && !intervalMinutes) return null;

  const normalized = {
    id: normalizeScheduledTriggerId(rawTrigger.id) || createScheduledTriggerId(),
    enabled: rawTrigger.enabled !== false,
    recurrenceType,
    timezone: normalizeScheduledTriggerTimeZone(rawTrigger.timezone, fallbackTimeZone),
    prompt,
  };
  if (recurrenceType === 'daily') {
    normalized.timeOfDay = timeOfDay;
  } else {
    normalized.intervalMinutes = intervalMinutes;
  }

  const label = typeof rawTrigger.label === 'string' ? rawTrigger.label.trim() : '';
  if (label) normalized.label = label.slice(0, 120);

  const presetId = normalizeScheduledTriggerPresetId(rawTrigger.presetId);
  if (presetId) normalized.presetId = presetId;

  const model = typeof rawTrigger.model === 'string' ? rawTrigger.model.trim() : '';
  if (model) normalized.model = model.slice(0, 160);

  const lastRunAt = extractIsoString(rawTrigger.lastRunAt);
  if (lastRunAt) normalized.lastRunAt = lastRunAt;

  const lastStatus = typeof rawTrigger.lastRunStatus === 'string' ? rawTrigger.lastRunStatus.trim() : '';
  if (lastStatus) normalized.lastRunStatus = lastStatus.slice(0, 40);

  const lastError = typeof rawTrigger.lastError === 'string' ? rawTrigger.lastError.trim() : '';
  if (lastError) normalized.lastError = lastError.slice(0, 500);

  if (normalized.enabled) {
    const nextRunAt = extractIsoString(rawTrigger.nextRunAt)
      || computeNextScheduledTriggerRunAt(normalized, nowMs);
    if (nextRunAt) normalized.nextRunAt = nextRunAt;
  }

  return normalized;
}

export function normalizeStoredScheduledTriggers(rawTriggers, options = {}) {
  const sourceList = Array.isArray(rawTriggers)
    ? rawTriggers
    : (rawTriggers && typeof rawTriggers === 'object' ? [rawTriggers] : []);
  const normalized = [];
  const seenIds = new Set();
  for (const rawTrigger of sourceList) {
    const next = normalizeStoredScheduledTrigger(rawTrigger, options);
    if (!next) continue;
    if (!next.id || seenIds.has(next.id)) {
      next.id = createScheduledTriggerId();
    }
    seenIds.add(next.id);
    normalized.push(next);
  }
  return normalized;
}

export function computeNextScheduledTriggerRunAt(trigger, nowMs = Date.now(), anchorMs = null) {
  if (!trigger || typeof trigger !== 'object') return '';
  const recurrenceType = normalizeScheduledTriggerRecurrenceType(trigger.recurrenceType);
  if (recurrenceType === 'interval') {
    return computeNextIntervalRunAt(trigger.intervalMinutes, nowMs, anchorMs);
  }
  return computeNextDailyRunAt(trigger.timeOfDay, trigger.timezone, nowMs);
}

export function normalizeScheduledTrigger(rawTrigger, { preserveRuntimeState = false } = {}) {
  const normalized = normalizeStoredScheduledTrigger(rawTrigger);
  if (!normalized) return null;
  const next = {
    ...normalized,
    content: normalized.prompt,
  };
  if (!preserveRuntimeState) {
    delete next.lastRunAt;
    delete next.lastRunStatus;
    delete next.lastError;
  }
  return next;
}

export function normalizeScheduledTriggers(rawTriggers, { preserveRuntimeState = false } = {}) {
  return normalizeStoredScheduledTriggers(rawTriggers).map((normalized) => {
    const next = {
      ...normalized,
      content: normalized.prompt,
    };
    if (!preserveRuntimeState) {
      delete next.lastRunAt;
      delete next.lastRunStatus;
      delete next.lastError;
    }
    return next;
  });
}

export function getPrimaryScheduledTrigger(rawTriggers) {
  const normalized = normalizeScheduledTriggers(rawTriggers, { preserveRuntimeState: true });
  if (!normalized.length) return null;
  const pool = normalized.filter((trigger) => trigger.enabled !== false);
  const ranked = (pool.length ? pool : normalized)
    .map((trigger, index) => ({
      trigger,
      index,
      nextRunAtMs: Date.parse(trigger.nextRunAt || ''),
    }))
    .sort((left, right) => {
      const leftFinite = Number.isFinite(left.nextRunAtMs);
      const rightFinite = Number.isFinite(right.nextRunAtMs);
      if (leftFinite && rightFinite && left.nextRunAtMs !== right.nextRunAtMs) {
        return left.nextRunAtMs - right.nextRunAtMs;
      }
      if (leftFinite !== rightFinite) {
        return leftFinite ? -1 : 1;
      }
      return left.index - right.index;
    });
  return ranked[0]?.trigger || null;
}
