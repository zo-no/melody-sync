/**
 * Session metadata persistence — SQLite-backed with JSON data column.
 *
 * STORAGE CONTRACT:
 *   - sessions.db (SQLite, WAL mode) is the single source of truth.
 *   - Stable query fields are indexed columns; the full object lives in `data` (JSON).
 *   - All writes go through withSessionsMetaMutation() which uses SQLite transactions.
 *   - On every load, normalizeStoredSessionMeta() cleans up stale/invalid fields.
 *   - SESSIONS.md is a human-readable index derived from the DB — regenerated on writes.
 *
 * MIGRATION:
 *   - On first boot, if chat-sessions.json exists and sessions.db does not,
 *     data is automatically migrated from JSON → SQLite.
 *
 * CRITICAL: All mutations MUST use withSessionsMetaMutation() or mutateSessionMeta().
 *
 * NORMALIZATION (happens on every load):
 *   - Invalid workflowState/workflowPriority values are deleted
 *   - Malformed timestamps are deleted
 *   - Missing folder gets defaulted to '~'
 *   - Missing ordinals are assigned sequentially
 */
import { existsSync } from 'fs';
import { CHAT_SESSIONS_FILE, CHAT_SESSIONS_INDEX_FILE } from '../../lib/config.mjs';
import {
  createSerialTaskQueue,
  ensureDir,
  readJson,
  writeTextAtomic,
} from '../fs-utils.mjs';
import {
  normalizeSessionWorkflowPriority,
  normalizeSessionWorkflowState,
} from './workflow-state.mjs';
import { normalizeSessionAgreements } from './agreements.mjs';
import { normalizeSessionPersistent } from '../session-persistent/core.mjs';
import { canonicalizeSessionFolder, inspectSessionFolder } from './folder.mjs';
import { normalizeSessionTaskCard } from './task-card.mjs';
import { buildSessionsIndexMarkdown } from './list-index.mjs';
import { normalizeSessionGroup, normalizeSessionOrdinal } from './naming.mjs';
import {
  normalizeSessionTaskListOrigin,
  normalizeSessionTaskListVisibility,
} from './visibility.mjs';
import {
  openSessionDb,
  dbLoadAllSessions,
  dbGetSession,
  dbFindByExternalTriggerId,
  dbUpsertSession,
  dbUpsertSessions,
  dbDeleteSession,
} from './session-db.mjs';

// ---------------------------------------------------------------------------
// Normalization helpers (unchanged from JSON era)
// ---------------------------------------------------------------------------

function normalizeStoredTimestamp(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  const time = Date.parse(trimmed);
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

function normalizeStoredSidebarOrder(value) {
  const parsed = typeof value === 'number'
    ? value
    : parseInt(String(value || '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function getStoredSessionMetaSortTime(meta) {
  const created = normalizeStoredTimestamp(meta?.created);
  const updatedAt = normalizeStoredTimestamp(meta?.updatedAt);
  const parsed = Date.parse(created || updatedAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function assignMissingSessionOrdinals(list) {
  const entries = Array.isArray(list) ? list : [];
  let changed = false;
  const used = new Set();
  let maxOrdinal = 0;

  for (const entry of entries) {
    const normalizedOrdinal = normalizeSessionOrdinal(entry?.ordinal);
    if (!normalizedOrdinal || used.has(normalizedOrdinal)) {
      if (entry && Object.prototype.hasOwnProperty.call(entry, 'ordinal')) {
        delete entry.ordinal;
        changed = true;
      }
      continue;
    }
    if (entry.ordinal !== normalizedOrdinal) {
      entry.ordinal = normalizedOrdinal;
      changed = true;
    }
    used.add(normalizedOrdinal);
    maxOrdinal = Math.max(maxOrdinal, normalizedOrdinal);
  }

  const missing = entries
    .filter((entry) => normalizeSessionOrdinal(entry?.ordinal) === 0)
    .sort((left, right) => {
      const timeDiff = getStoredSessionMetaSortTime(left) - getStoredSessionMetaSortTime(right);
      if (timeDiff !== 0) return timeDiff;
      return String(left?.id || '').localeCompare(String(right?.id || ''));
    });

  let nextOrdinal = maxOrdinal + 1;
  for (const entry of missing) {
    while (used.has(nextOrdinal)) nextOrdinal += 1;
    entry.ordinal = nextOrdinal;
    used.add(nextOrdinal);
    nextOrdinal += 1;
    changed = true;
  }

  return changed;
}

function normalizeStoredSessionMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return { meta: null, changed: true };
  }

  const normalized = { ...meta };
  let changed = false;

  for (const legacyField of ['activeRun', 'status', 'queuedMessageCount', 'pendingCompact', 'renameState', 'renameError', 'recoverable', 'appId', 'appName']) {
    if (Object.prototype.hasOwnProperty.call(normalized, legacyField)) {
      delete normalized[legacyField];
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'workflowState')) {
    const nextWorkflowState = normalizeSessionWorkflowState(normalized.workflowState || '');
    if (nextWorkflowState) {
      if (normalized.workflowState !== nextWorkflowState) {
        normalized.workflowState = nextWorkflowState;
        changed = true;
      }
    } else {
      delete normalized.workflowState;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'workflowPriority')) {
    const nextWorkflowPriority = normalizeSessionWorkflowPriority(normalized.workflowPriority || '');
    if (nextWorkflowPriority) {
      if (normalized.workflowPriority !== nextWorkflowPriority) {
        normalized.workflowPriority = nextWorkflowPriority;
        changed = true;
      }
    } else {
      delete normalized.workflowPriority;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'lastReviewedAt')) {
    const nextLastReviewedAt = normalizeStoredTimestamp(normalized.lastReviewedAt);
    if (nextLastReviewedAt) {
      if (normalized.lastReviewedAt !== nextLastReviewedAt) {
        normalized.lastReviewedAt = nextLastReviewedAt;
        changed = true;
      }
    } else {
      delete normalized.lastReviewedAt;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'sidebarOrder')) {
    const nextSidebarOrder = normalizeStoredSidebarOrder(normalized.sidebarOrder);
    if (nextSidebarOrder) {
      if (normalized.sidebarOrder !== nextSidebarOrder) {
        normalized.sidebarOrder = nextSidebarOrder;
        changed = true;
      }
    } else {
      delete normalized.sidebarOrder;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'manualGroup')) {
    const nextManualGroup = normalizeSessionGroup(normalized.manualGroup || '');
    if (nextManualGroup) {
      if (normalized.manualGroup !== nextManualGroup) {
        normalized.manualGroup = nextManualGroup;
        changed = true;
      }
    } else {
      delete normalized.manualGroup;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'taskListOrigin')) {
    const nextTaskListOrigin = normalizeSessionTaskListOrigin(normalized.taskListOrigin);
    if (nextTaskListOrigin) {
      if (normalized.taskListOrigin !== nextTaskListOrigin) {
        normalized.taskListOrigin = nextTaskListOrigin;
        changed = true;
      }
    } else {
      delete normalized.taskListOrigin;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'taskListVisibility')) {
    const nextTaskListVisibility = normalizeSessionTaskListVisibility(normalized.taskListVisibility);
    if (nextTaskListVisibility) {
      if (normalized.taskListVisibility !== nextTaskListVisibility) {
        normalized.taskListVisibility = nextTaskListVisibility;
        changed = true;
      }
    } else {
      delete normalized.taskListVisibility;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'ordinal')) {
    const nextOrdinal = normalizeSessionOrdinal(normalized.ordinal);
    if (nextOrdinal) {
      if (normalized.ordinal !== nextOrdinal) {
        normalized.ordinal = nextOrdinal;
        changed = true;
      }
    } else {
      delete normalized.ordinal;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'activeAgreements')) {
    const nextActiveAgreements = normalizeSessionAgreements(normalized.activeAgreements);
    if (nextActiveAgreements.length > 0) {
      if (JSON.stringify(normalized.activeAgreements) !== JSON.stringify(nextActiveAgreements)) {
        normalized.activeAgreements = nextActiveAgreements;
        changed = true;
      }
    } else {
      delete normalized.activeAgreements;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'taskCard')) {
    const nextTaskCard = normalizeSessionTaskCard(normalized.taskCard);
    if (nextTaskCard) {
      if (JSON.stringify(normalized.taskCard) !== JSON.stringify(nextTaskCard)) {
        normalized.taskCard = nextTaskCard;
        changed = true;
      }
    } else {
      delete normalized.taskCard;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'persistent')) {
    const nextPersistent = normalizeSessionPersistent(normalized.persistent);
    if (nextPersistent) {
      if (JSON.stringify(normalized.persistent) !== JSON.stringify(nextPersistent)) {
        normalized.persistent = nextPersistent;
        changed = true;
      }
    } else {
      delete normalized.persistent;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'folder')) {
    const folderState = inspectSessionFolder(normalized.folder, {
      allowPersistentFallback: false,
    });
    const nextFolder = folderState.available
      ? folderState.storedFolder
      : canonicalizeSessionFolder(normalized.folder);
    if (nextFolder && normalized.folder !== nextFolder) {
      normalized.folder = nextFolder;
      changed = true;
    }
  } else {
    normalized.folder = '~';
    changed = true;
  }

  if (
    Object.prototype.hasOwnProperty.call(normalized, 'scheduledTriggers')
    || Object.prototype.hasOwnProperty.call(normalized, 'scheduledTrigger')
  ) {
    if (Object.prototype.hasOwnProperty.call(normalized, 'scheduledTriggers')) {
      delete normalized.scheduledTriggers;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'scheduledTrigger')) {
      delete normalized.scheduledTrigger;
      changed = true;
    }
  }

  return { meta: normalized, changed };
}

function normalizeStoredSessionsMeta(list) {
  let changed = false;
  const normalized = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const result = normalizeStoredSessionMeta(entry);
    if (!result.meta) {
      changed = true;
      continue;
    }
    normalized.push(result.meta);
    changed = changed || result.changed;
  }
  changed = assignMissingSessionOrdinals(normalized) || changed;
  return { list: normalized, changed };
}

// ---------------------------------------------------------------------------
// Migration: JSON → SQLite (runs once on first boot)
// ---------------------------------------------------------------------------

async function migrateFromJsonIfNeeded(db) {
  if (!existsSync(CHAT_SESSIONS_FILE)) return;
  // Already migrated if DB has rows
  const { n } = db.prepare('SELECT COUNT(*) as n FROM sessions').get();
  if (n > 0) return;

  console.log('[meta-store] Migrating chat-sessions.json → sessions.db ...');
  const raw = await readJson(CHAT_SESSIONS_FILE, []);
  const { list, changed } = normalizeStoredSessionsMeta(raw);
  dbUpsertSessions(db, list);
  if (changed) {
    // Write normalized SESSIONS.md alongside
    await writeTextAtomic(CHAT_SESSIONS_INDEX_FILE, buildSessionsIndexMarkdown(list));
  }
  console.log(`[meta-store] Migrated ${list.length} sessions.`);
}

// ---------------------------------------------------------------------------
// DB initialization (called once at startup)
// ---------------------------------------------------------------------------

let _dbReady = null;
// Serial queue: better-sqlite3 transactions are sync-only, so we use an
// async serial queue to ensure mutations don't interleave at the JS level.
const runSessionsMetaMutation = createSerialTaskQueue();

async function getDb() {
  if (_dbReady) return _dbReady;
  const db = await openSessionDb();
  await migrateFromJsonIfNeeded(db);
  _dbReady = db;
  return db;
}

// ---------------------------------------------------------------------------
// Internal save helper — writes to DB + regenerates SESSIONS.md
// ---------------------------------------------------------------------------

async function saveSessionsMetaUnlocked(db, list) {
  dbUpsertSessions(db, list);
  await ensureDir(CHAT_SESSIONS_INDEX_FILE.replace(/[^/\\]+$/, ''));
  await writeTextAtomic(CHAT_SESSIONS_INDEX_FILE, buildSessionsIndexMarkdown(list));
}

// ---------------------------------------------------------------------------
// Public API (same interface as before)
// ---------------------------------------------------------------------------

export async function loadSessionsMeta() {
  const db = await getDb();
  const raw = dbLoadAllSessions(db);
  const { list, changed } = normalizeStoredSessionsMeta(raw);
  if (changed) {
    // Persist normalized data back
    dbUpsertSessions(db, list);
    await writeTextAtomic(CHAT_SESSIONS_INDEX_FILE, buildSessionsIndexMarkdown(list));
  }
  return list;
}

export function findSessionMetaCached(sessionId) {
  // With SQLite we can do a fast point lookup; no in-memory cache needed.
  const db = _dbReady;
  if (!db) return null;
  return dbGetSession(db, sessionId);
}

export async function findSessionMeta(sessionId) {
  const db = await getDb();
  return dbGetSession(db, sessionId);
}

export async function findSessionByExternalTriggerId(externalTriggerId) {
  const normalized = typeof externalTriggerId === 'string' ? externalTriggerId.trim() : '';
  if (!normalized) return null;
  const db = await getDb();
  return dbFindByExternalTriggerId(db, normalized);
}

export async function withSessionsMetaMutation(mutator) {
  const db = await getDb();
  // better-sqlite3 transactions must be synchronous, so we use a serial async
  // queue for mutual exclusion at the JS level, then wrap the DB writes in a
  // sync BEGIN/COMMIT for atomicity.
  return runSessionsMetaMutation(async () => {
    const metas = dbLoadAllSessions(db);
    let result;
    let saveError;
    const save = async (updatedMetas) => {
      // Synchronous SQLite writes inside an explicit transaction.
      try {
        db.prepare('BEGIN').run();
        await saveSessionsMetaUnlocked(db, updatedMetas);
        db.prepare('COMMIT').run();
      } catch (err) {
        try { db.prepare('ROLLBACK').run(); } catch {}
        saveError = err;
        throw err;
      }
    };
    result = await mutator(metas, save);
    if (saveError) throw saveError;
    return result;
  });
}

export async function mutateSessionMeta(sessionId, mutator) {
  return withSessionsMetaMutation(async (metas, saveSessionsMeta) => {
    const index = metas.findIndex((meta) => meta.id === sessionId);
    if (index === -1) return { meta: null, changed: false };

    const current = metas[index];
    const draft = { ...current };
    const changed = mutator(draft, current) === true;
    if (!changed) {
      return { meta: current, changed: false };
    }

    metas[index] = draft;
    await saveSessionsMeta(metas);
    return { meta: draft, changed: true };
  });
}

// ---------------------------------------------------------------------------
// Low-level helpers used by system-project.mjs and other callers that
// need to delete a session directly without going through the full mutation.
// ---------------------------------------------------------------------------

export async function deleteSessionMeta(sessionId) {
  const db = await getDb();
  dbDeleteSession(db, sessionId);
}
