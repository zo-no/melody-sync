/**
 * Session metadata persistence — reads and writes chat-sessions.json.
 *
 * STORAGE CONTRACT:
 *   - chat-sessions.json is the single source of truth for all session metadata.
 *   - All writes go through withSessionsMetaMutation() which serializes mutations.
 *   - On every load, normalizeStoredSessionMeta() cleans up stale/invalid fields.
 *   - SESSIONS.md is a human-readable index derived from the JSON — always regenerated alongside.
 *
 * CRITICAL: All mutations MUST use withSessionsMetaMutation() or mutateSessionMeta().
 *   Direct writes bypass the serial queue and will corrupt the file under concurrent load.
 *
 * NORMALIZATION (happens on every load):
 *   - Invalid workflowState/workflowPriority values are deleted
 *   - Malformed timestamps are deleted
 *   - Missing folder gets defaulted to '~'
 *   - Missing ordinals are assigned sequentially
 */
import { dirname } from 'path';
import { CHAT_SESSIONS_FILE, CHAT_SESSIONS_INDEX_FILE } from '../../lib/config.mjs';
import {
  createSerialTaskQueue,
  ensureDir,
  readJson,
  statOrNull,
  writeJsonAtomic,
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

let sessionsMetaCache = null;
let sessionsMetaCacheMtimeMs = null;
const runSessionsMetaMutation = createSerialTaskQueue();

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

  for (const legacyField of ['activeRun', 'status', 'queuedMessageCount', 'pendingCompact', 'renameState', 'renameError', 'recoverable']) {
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

async function saveSessionsMetaUnlocked(list) {
  const dir = dirname(CHAT_SESSIONS_FILE);
  await ensureDir(dir);
  await writeJsonAtomic(CHAT_SESSIONS_FILE, list);
  await writeTextAtomic(CHAT_SESSIONS_INDEX_FILE, buildSessionsIndexMarkdown(list));
  sessionsMetaCache = list;
  sessionsMetaCacheMtimeMs = (await statOrNull(CHAT_SESSIONS_FILE))?.mtimeMs ?? null;
}

export async function loadSessionsMeta() {
  const stats = await statOrNull(CHAT_SESSIONS_FILE);
  if (!stats) {
    sessionsMetaCache = [];
    sessionsMetaCacheMtimeMs = null;
    return sessionsMetaCache;
  }

  const mtimeMs = stats.mtimeMs;
  if (sessionsMetaCache && sessionsMetaCacheMtimeMs === mtimeMs) {
    return sessionsMetaCache;
  }

  const parsed = await readJson(CHAT_SESSIONS_FILE, []);
  const normalized = normalizeStoredSessionsMeta(parsed);
  sessionsMetaCache = normalized.list;
  if (normalized.changed) {
    await saveSessionsMetaUnlocked(sessionsMetaCache);
  } else {
    sessionsMetaCacheMtimeMs = mtimeMs;
    if (!(await statOrNull(CHAT_SESSIONS_INDEX_FILE))) {
      await writeTextAtomic(CHAT_SESSIONS_INDEX_FILE, buildSessionsIndexMarkdown(sessionsMetaCache));
    }
  }
  return sessionsMetaCache;
}

export function findSessionMetaCached(sessionId) {
  if (!Array.isArray(sessionsMetaCache)) return null;
  return sessionsMetaCache.find((meta) => meta.id === sessionId) || null;
}

export async function findSessionMeta(sessionId) {
  const metas = await loadSessionsMeta();
  return metas.find((meta) => meta.id === sessionId) || null;
}

export async function findSessionByExternalTriggerId(externalTriggerId) {
  const normalized = typeof externalTriggerId === 'string' ? externalTriggerId.trim() : '';
  if (!normalized) return null;
  const metas = await loadSessionsMeta();
  return metas.find((meta) => meta.externalTriggerId === normalized && !meta.archived) || null;
}

export async function withSessionsMetaMutation(mutator) {
  return runSessionsMetaMutation(async () => {
    const metas = await loadSessionsMeta();
    return mutator(metas, saveSessionsMetaUnlocked);
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
