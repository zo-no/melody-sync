import { readFile } from 'fs/promises';
import { join } from 'path';
import { CHAT_HISTORY_DIR } from '../lib/config.mjs';
import {
  createKeyedTaskQueue,
  ensureDir,
  readJson,
  removePath,
  writeJsonAtomic,
  writeTextAtomic,
} from './fs-utils.mjs';

const EVENT_FILE_WIDTH = 9;
const BODY_FIELD_BY_TYPE = {
  message: 'content',
  reasoning: 'content',
  template_context: 'content',
  tool_use: 'toolInput',
  tool_result: 'output',
};
const DEFERRED_INDEX_BODY_TYPES = new Set(['message', 'reasoning', 'template_context', 'tool_use', 'tool_result']);
const INLINE_BODY_LIMITS = {
  message: 64 * 1024,
  reasoning: 0,
  template_context: 4096,
  tool_use: 2048,
  tool_result: 4096,
  status: 4096,
};
const PREVIEW_LIMITS = {
  message: 1600,
  reasoning: 1600,
  template_context: 1600,
  tool_use: 800,
  tool_result: 1200,
  status: 800,
};
const BODY_STORAGE_MODES = {
  INLINE: 'inline',
  EXTERNALIZE: 'externalize',
  PREVIEW_ONLY: 'preview_only',
};

const metaCache = new Map();
const contextCache = new Map();
const forkContextCache = new Map();
const eventCache = new Map();
const bodyCache = new Map();
const runSessionMutation = createKeyedTaskQueue();

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function clipMiddle(text, maxChars) {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  const head = Math.max(1, Math.floor(maxChars * 0.6));
  const tail = Math.max(1, maxChars - head);
  return `${text.slice(0, head).trimEnd()}\n[... truncated by MelodySync ...]\n${text.slice(-tail).trimStart()}`;
}

function eventCacheKey(sessionId, seq) {
  return `${sessionId}:${seq}`;
}

function bodyCacheKey(sessionId, ref) {
  return `${sessionId}:${ref}`;
}

function sessionDir(sessionId) {
  return join(CHAT_HISTORY_DIR, sessionId);
}

function sessionMetaPath(sessionId) {
  return join(sessionDir(sessionId), 'meta.json');
}

function sessionContextPath(sessionId) {
  return join(sessionDir(sessionId), 'context.json');
}

function sessionForkContextPath(sessionId) {
  return join(sessionDir(sessionId), 'fork-context.json');
}

function sessionEventsDir(sessionId) {
  return join(sessionDir(sessionId), 'events');
}

function sessionBodiesDir(sessionId) {
  return join(sessionDir(sessionId), 'bodies');
}

function eventPath(sessionId, seq) {
  return join(sessionEventsDir(sessionId), `${String(seq).padStart(EVENT_FILE_WIDTH, '0')}.json`);
}

function bodyPath(sessionId, ref) {
  return join(sessionBodiesDir(sessionId), `${ref}.txt`);
}

async function ensureSessionDir(sessionId) {
  await ensureDir(sessionDir(sessionId));
  await ensureDir(sessionEventsDir(sessionId));
  await ensureDir(sessionBodiesDir(sessionId));
}

function emptyMeta() {
  return {
    latestSeq: 0,
    lastEventAt: null,
    size: 0,
    counts: {},
  };
}

function normalizeStoredEvent(event, fallbackSeq) {
  const seq = Number.isInteger(event?.seq) ? event.seq : fallbackSeq;
  return {
    ...(event || {}),
    seq,
    timestamp: Number.isFinite(event?.timestamp) ? event.timestamp : Date.now(),
  };
}

function eventBodyField(event) {
  return BODY_FIELD_BY_TYPE[event?.type] || null;
}

function previewLimitFor(event) {
  return PREVIEW_LIMITS[event?.type] || 800;
}

function inlineLimitFor(event) {
  return INLINE_BODY_LIMITS[event?.type] ?? 4096;
}

function bodyStorageModeFor(event, raw = '') {
  if (!raw) return BODY_STORAGE_MODES.INLINE;
  switch (event?.type) {
    case 'message':
      return raw.length > inlineLimitFor(event)
        ? BODY_STORAGE_MODES.EXTERNALIZE
        : BODY_STORAGE_MODES.INLINE;
    case 'reasoning':
    case 'template_context':
    case 'tool_use':
    case 'tool_result':
      return raw.length > inlineLimitFor(event)
        ? BODY_STORAGE_MODES.EXTERNALIZE
        : BODY_STORAGE_MODES.INLINE;
    default:
      return raw.length > inlineLimitFor(event)
        ? BODY_STORAGE_MODES.EXTERNALIZE
        : BODY_STORAGE_MODES.INLINE;
  }
}

function shouldDeferEventBodyInIndex(event, options = {}) {
  if (options.includeBodies === true) return false;
  return DEFERRED_INDEX_BODY_TYPES.has(event?.type);
}

function serializeEventForIndex(event, options = {}) {
  const next = clone(event);
  if (!shouldDeferEventBodyInIndex(next, options)) {
    return next;
  }
  const bodyField = eventBodyField(next);
  if (!bodyField) {
    return next;
  }
  const inlineBody = typeof next[bodyField] === 'string' ? next[bodyField] : '';
  const hasBody = !!inlineBody || next.bodyAvailable === true || !!next.bodyRef;
  const preview = next.type === 'message'
    ? ''
    : (inlineBody ? clipMiddle(inlineBody, previewLimitFor(next)) : '');
  next[bodyField] = '';
  next.bodyField = bodyField;
  next.bodyAvailable = hasBody;
  next.bodyLoaded = false;
  if (preview) {
    next.bodyPreview = preview;
  } else {
    delete next.bodyPreview;
  }
  if (hasBody && !Number.isInteger(next.bodyBytes) && inlineBody) {
    next.bodyBytes = Buffer.byteLength(inlineBody, 'utf8');
  }
  return next;
}

async function loadMeta(sessionId) {
  if (metaCache.has(sessionId)) {
    return clone(metaCache.get(sessionId));
  }
  const meta = await readJson(sessionMetaPath(sessionId), emptyMeta());
  metaCache.set(sessionId, meta);
  return clone(meta);
}

async function saveMetaUnlocked(sessionId, meta) {
  const normalized = {
    ...emptyMeta(),
    ...(meta || {}),
    counts: { ...(meta?.counts || {}) },
  };
  await ensureSessionDir(sessionId);
  await writeJsonAtomic(sessionMetaPath(sessionId), normalized);
  metaCache.set(sessionId, normalized);
  return clone(normalized);
}

async function loadContext(sessionId) {
  const context = await readJson(sessionContextPath(sessionId), null);
  contextCache.set(sessionId, context);
  return clone(context);
}

async function loadForkContext(sessionId) {
  const context = await readJson(sessionForkContextPath(sessionId), null);
  forkContextCache.set(sessionId, context);
  return clone(context);
}

function normalizeForkContext(context = {}) {
  return {
    mode: context.mode === 'summary' ? 'summary' : 'history',
    summary: typeof context.summary === 'string' ? context.summary.trim() : '',
    continuationBody: typeof context.continuationBody === 'string' ? context.continuationBody.trim() : '',
    activeFromSeq: Number.isInteger(context.activeFromSeq) ? context.activeFromSeq : 0,
    preparedThroughSeq: Number.isInteger(context.preparedThroughSeq) ? context.preparedThroughSeq : 0,
    contextUpdatedAt: typeof context.contextUpdatedAt === 'string' && context.contextUpdatedAt.trim()
      ? context.contextUpdatedAt.trim()
      : null,
    updatedAt: typeof context.updatedAt === 'string' && context.updatedAt.trim()
      ? context.updatedAt.trim()
      : new Date().toISOString(),
    source: typeof context.source === 'string' && context.source.trim()
      ? context.source.trim()
      : 'history',
  };
}

async function saveContextUnlocked(sessionId, context) {
  await ensureSessionDir(sessionId);
  await writeJsonAtomic(sessionContextPath(sessionId), context || null);
  contextCache.set(sessionId, context || null);
  return clone(context || null);
}

async function saveForkContextUnlocked(sessionId, context) {
  const normalized = context ? normalizeForkContext(context) : null;
  await ensureSessionDir(sessionId);
  await writeJsonAtomic(sessionForkContextPath(sessionId), normalized);
  forkContextCache.set(sessionId, normalized);
  return clone(normalized);
}

async function clearContextUnlocked(sessionId) {
  await ensureSessionDir(sessionId);
  await writeJsonAtomic(sessionContextPath(sessionId), null);
  contextCache.set(sessionId, null);
}

async function clearForkContextUnlocked(sessionId) {
  await ensureSessionDir(sessionId);
  await writeJsonAtomic(sessionForkContextPath(sessionId), null);
  forkContextCache.set(sessionId, null);
}

async function writeBody(sessionId, seq, field, value) {
  await ensureSessionDir(sessionId);
  const ref = `evt_${String(seq).padStart(EVENT_FILE_WIDTH, '0')}_${field}`;
  await writeTextAtomic(bodyPath(sessionId, ref), value || '');
  bodyCache.set(bodyCacheKey(sessionId, ref), value || '');
  return ref;
}

async function readBody(sessionId, ref) {
  if (!ref) return '';
  const key = bodyCacheKey(sessionId, ref);
  if (bodyCache.has(key)) return bodyCache.get(key);
  try {
    const value = await readFile(bodyPath(sessionId, ref), 'utf8');
    bodyCache.set(key, value);
    return value;
  } catch {
    return '';
  }
}

async function storeEvent(sessionId, event) {
  const normalized = normalizeStoredEvent(event, 0);
  const stored = { ...normalized };
  const bodyField = eventBodyField(stored);
  if (bodyField && typeof stored[bodyField] === 'string') {
    const raw = stored[bodyField];
    const storageMode = bodyStorageModeFor(stored, raw);
    const bodyBytes = raw ? Buffer.byteLength(raw, 'utf8') : 0;
    if (storageMode === BODY_STORAGE_MODES.EXTERNALIZE && raw) {
      stored[bodyField] = clipMiddle(raw, previewLimitFor(stored));
      stored.bodyAvailable = true;
      stored.bodyLoaded = false;
      stored.bodyField = bodyField;
      stored.bodyRef = await writeBody(sessionId, stored.seq, bodyField, raw);
      stored.bodyBytes = bodyBytes;
      stored.bodyPersistence = 'externalized';
      delete stored.bodyTruncated;
    } else if (storageMode === BODY_STORAGE_MODES.PREVIEW_ONLY && raw) {
      stored[bodyField] = clipMiddle(raw, previewLimitFor(stored));
      stored.bodyAvailable = true;
      stored.bodyLoaded = true;
      stored.bodyField = bodyField;
      stored.bodyBytes = bodyBytes;
      stored.bodyPersistence = 'preview_only';
      stored.bodyTruncated = stored[bodyField] !== raw;
      delete stored.bodyRef;
    } else {
      stored.bodyAvailable = !!raw;
      stored.bodyLoaded = true;
      if (raw) {
        stored.bodyField = bodyField;
        stored.bodyBytes = bodyBytes;
      } else {
        delete stored.bodyField;
        delete stored.bodyBytes;
      }
      delete stored.bodyRef;
      delete stored.bodyPersistence;
      delete stored.bodyTruncated;
    }
  }
  await ensureSessionDir(sessionId);
  await writeJsonAtomic(eventPath(sessionId, stored.seq), stored);
  eventCache.set(eventCacheKey(sessionId, stored.seq), stored);
  return clone(stored);
}

async function loadStoredEvent(sessionId, seq) {
  const key = eventCacheKey(sessionId, seq);
  if (eventCache.has(key)) {
    return clone(eventCache.get(key));
  }
  const stored = await readJson(eventPath(sessionId, seq), null);
  if (stored) {
    eventCache.set(key, stored);
  }
  return clone(stored);
}

async function countMessageEventsAfter(sessionId, afterSeq = 0) {
  const meta = await loadMeta(sessionId);
  const fromSeq = Math.max(1, afterSeq + 1);
  if (fromSeq > meta.latestSeq) return 0;
  const seqs = Array.from({ length: meta.latestSeq - fromSeq + 1 }, (_, i) => fromSeq + i);
  const events = await Promise.all(seqs.map((seq) => loadStoredEvent(sessionId, seq)));
  return events.filter((e) => e?.type === 'message').length;
}

async function hydrateEvent(sessionId, event) {
  if (!event?.bodyRef || !event?.bodyField) return event;
  const hydrated = { ...event };
  hydrated[hydrated.bodyField] = await readBody(sessionId, hydrated.bodyRef);
  hydrated.bodyLoaded = true;
  return hydrated;
}

function incrementCounts(counts, event) {
  const next = { ...(counts || {}) };
  next[event.type] = (next[event.type] || 0) + 1;
  if (event.type === 'message' && event.role === 'user') {
    next.message_user = (next.message_user || 0) + 1;
  }
  if (event.type === 'message' && event.role === 'assistant') {
    next.message_assistant = (next.message_assistant || 0) + 1;
  }
  return next;
}

async function appendEventUnlocked(sessionId, event) {
  await ensureSessionDir(sessionId);
  const meta = await loadMeta(sessionId);
  const seq = meta.latestSeq + 1;
  const normalized = normalizeStoredEvent(event, seq);
  normalized.seq = seq;
  const stored = await storeEvent(sessionId, normalized);
  await saveMetaUnlocked(sessionId, {
    latestSeq: seq,
    lastEventAt: stored.timestamp || Date.now(),
    size: meta.size + 1,
    counts: incrementCounts(meta.counts, stored),
  });
  return stored;
}

async function appendEventsUnlocked(sessionId, events) {
  await ensureSessionDir(sessionId);
  const meta = await loadMeta(sessionId);
  let latestSeq = meta.latestSeq;
  let lastEventAt = meta.lastEventAt;
  let size = meta.size;
  let counts = meta.counts;
  const appended = [];
  for (const event of events || []) {
    latestSeq += 1;
    const normalized = normalizeStoredEvent(event, latestSeq);
    normalized.seq = latestSeq;
    const stored = await storeEvent(sessionId, normalized);
    appended.push(stored);
    lastEventAt = stored.timestamp || lastEventAt;
    size += 1;
    counts = incrementCounts(counts, stored);
  }
  await saveMetaUnlocked(sessionId, {
    latestSeq,
    lastEventAt,
    size,
    counts,
  });
  return appended;
}

function clearSessionCaches(sessionId) {
  metaCache.delete(sessionId);
  contextCache.delete(sessionId);
  forkContextCache.delete(sessionId);
  for (const key of [...eventCache.keys()]) {
    if (key.startsWith(`${sessionId}:`)) eventCache.delete(key);
  }
  for (const key of [...bodyCache.keys()]) {
    if (key.startsWith(`${sessionId}:`)) bodyCache.delete(key);
  }
}

async function clearHistoryUnlocked(sessionId) {
  await removePath(sessionDir(sessionId));
  clearSessionCaches(sessionId);
}

export async function clearSessionHistory(sessionId) {
  return runSessionMutation(sessionId, async () => clearHistoryUnlocked(sessionId));
}

export async function loadHistory(sessionId, options = {}) {
  const meta = await loadMeta(sessionId);
  const includeBodies = options.includeBodies !== false;
  const fromSeq = Number.isInteger(options.fromSeq) && options.fromSeq > 0 ? options.fromSeq : 1;
  if (fromSeq > meta.latestSeq) return [];
  const seqs = Array.from({ length: meta.latestSeq - fromSeq + 1 }, (_, i) => fromSeq + i);
  const stored = await Promise.all(seqs.map((seq) => loadStoredEvent(sessionId, seq)));
  const valid = stored.filter(Boolean);
  if (!includeBodies) return valid;
  return Promise.all(valid.map((event) => hydrateEvent(sessionId, event)));
}

export async function readLastTurnEvents(sessionId, options = {}) {
  const meta = await loadMeta(sessionId);
  const includeBodies = options.includeBodies !== false;
  const events = [];
  for (let seq = meta.latestSeq; seq >= 1; seq -= 1) {
    const stored = await loadStoredEvent(sessionId, seq);
    if (!stored) continue;
    events.unshift(includeBodies ? await hydrateEvent(sessionId, stored) : stored);
    if (stored.type === 'message' && stored.role === 'user') {
      break;
    }
  }
  return events;
}

export async function findLatestAssistantMessage(sessionId, options = {}) {
  const meta = await loadMeta(sessionId);
  const includeBodies = options.includeBodies !== false;
  const match = typeof options.match === 'function' ? options.match : null;
  for (let seq = meta.latestSeq; seq >= 1; seq -= 1) {
    const stored = await loadStoredEvent(sessionId, seq);
    if (!stored) continue;
    if (stored.type === 'message' && stored.role === 'assistant' && (!match || match(stored))) {
      return includeBodies ? hydrateEvent(sessionId, stored) : stored;
    }
  }
  return null;
}

export async function getHistorySnapshot(sessionId) {
  const [meta, context] = await Promise.all([
    loadMeta(sessionId),
    loadContext(sessionId),
  ]);
  const activeFromSeq = Number.isInteger(context?.activeFromSeq) ? context.activeFromSeq : 0;
  const messageCount = (meta.counts?.message_user || 0) + (meta.counts?.message_assistant || 0);
  const activeMessageCount = activeFromSeq > 0
    ? await countMessageEventsAfter(sessionId, activeFromSeq)
    : messageCount;
  return {
    latestSeq: meta.latestSeq || 0,
    lastEventAt: meta.lastEventAt || null,
    size: meta.size || 0,
    counts: { ...(meta.counts || {}) },
    messageCount,
    activeMessageCount,
    userMessageCount: meta.counts?.message_user || 0,
    contextMode: context?.mode || 'history',
    activeFromSeq,
    compactedThroughSeq: Number.isInteger(context?.compactedThroughSeq) ? context.compactedThroughSeq : 0,
    contextTokenEstimate: Number.isInteger(context?.inputTokens) ? context.inputTokens : null,
    contextUpdatedAt: context?.updatedAt || null,
  };
}

export async function appendEvent(sessionId, event) {
  return runSessionMutation(sessionId, async () => appendEventUnlocked(sessionId, event));
}

export async function appendEvents(sessionId, events) {
  return runSessionMutation(sessionId, async () => appendEventsUnlocked(sessionId, events));
}

export async function readEventsAfter(sessionId, afterSeq = 0, options = {}) {
  const meta = await loadMeta(sessionId);
  const includeBodies = options.includeBodies === true;
  const fromSeq = Math.max(1, afterSeq + 1);
  if (fromSeq > meta.latestSeq) return [];
  const seqs = Array.from({ length: meta.latestSeq - fromSeq + 1 }, (_, i) => fromSeq + i);
  const stored = await Promise.all(seqs.map((seq) => loadStoredEvent(sessionId, seq)));
  const valid = stored.filter(Boolean);
  if (includeBodies) return Promise.all(valid.map((e) => hydrateEvent(sessionId, e)));
  return valid.map((e) => serializeEventForIndex(e, options));
}

export async function readEventBody(sessionId, seq) {
  const stored = await loadStoredEvent(sessionId, seq);
  const bodyField = stored?.bodyField || eventBodyField(stored);
  if (!stored || !bodyField) return null;
  let body = '';
  if (stored.bodyRef) {
    body = await readBody(sessionId, stored.bodyRef);
  } else if (typeof stored[bodyField] === 'string') {
    body = stored[bodyField];
  }
  if (!body) return null;
  return {
    seq,
    field: bodyField,
    value: body,
    bytes: stored.bodyBytes || Buffer.byteLength(body, 'utf8'),
    ...(stored.bodyPersistence ? { persistence: stored.bodyPersistence } : {}),
    ...(stored.bodyTruncated === true ? { truncated: true } : {}),
  };
}

export async function getContextHead(sessionId) {
  return loadContext(sessionId);
}

export async function setContextHead(sessionId, context = {}) {
  return runSessionMutation(sessionId, async () => saveContextUnlocked(sessionId, {
    mode: context.mode || 'summary',
    summary: typeof context.summary === 'string' ? context.summary.trim() : '',
    activeFromSeq: Number.isInteger(context.activeFromSeq) ? context.activeFromSeq : 0,
    compactedThroughSeq: Number.isInteger(context.compactedThroughSeq) ? context.compactedThroughSeq : 0,
    inputTokens: Number.isInteger(context.inputTokens) ? context.inputTokens : null,
    updatedAt: context.updatedAt || new Date().toISOString(),
    source: context.source || 'manual',
    ...(typeof context.toolIndex === 'string' ? { toolIndex: context.toolIndex.trim() } : {}),
    ...(Number.isInteger(context.barrierSeq) ? { barrierSeq: context.barrierSeq } : {}),
    ...(Number.isInteger(context.handoffSeq) ? { handoffSeq: context.handoffSeq } : {}),
    ...(typeof context.compactionSessionId === 'string' && context.compactionSessionId.trim()
      ? { compactionSessionId: context.compactionSessionId.trim() }
      : {}),
  }));
}

export async function clearContextHead(sessionId) {
  return runSessionMutation(sessionId, async () => {
    await clearContextUnlocked(sessionId);
    return null;
  });
}

export async function getForkContext(sessionId) {
  return loadForkContext(sessionId);
}

export async function setForkContext(sessionId, context = {}) {
  return runSessionMutation(sessionId, async () => saveForkContextUnlocked(sessionId, context));
}

export async function clearForkContext(sessionId) {
  return runSessionMutation(sessionId, async () => {
    await clearForkContextUnlocked(sessionId);
    return null;
  });
}
