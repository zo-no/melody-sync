/**
 * Structured memory store for MelodySync.
 *
 * Each memory entry is a JSON object stored one-per-line in memory-store.jsonl.
 * Entries are immutable once written; updates create new entries that supersede old ones.
 *
 * Entry shape:
 *   id          string   — unique identifier
 *   text        string   — the memory content
 *   target      string   — which memory file this belongs to (bootstrap, agent-profile,
 *                          context-digest, projects, skills, tasks, worklog, global, system)
 *   createdAt   string   — ISO timestamp of first write
 *   updatedAt   string   — ISO timestamp of last update
 *   sessionId   string   — session that produced this memory
 *   sessionName string   — human-readable session name
 *   source      string   — 'agent' | 'user' | 'system'
 *   type        string   — optional type hint (preference, fact, project, skill, ...)
 *   confidence  number   — 0–1, how confident the agent is this is worth keeping
 *   status      string   — 'active' | 'superseded' | 'rejected'
 *   supersededBy string  — id of the entry that replaces this one (if status=superseded)
 *   importance  number   — 0–1, assigned at write time, updated by access patterns
 *   accessCount number   — how many times this entry has been retrieved
 *   lastAccessAt string  — ISO timestamp of last retrieval
 */

import { randomUUID } from 'crypto';
import { appendFile, readFile } from 'fs/promises';
import { join } from 'path';

import { MEMORY_DIR, MEMORY_STORE_FILE } from '../../lib/config.mjs';
import { ensureDir, writeTextAtomic } from '../fs-utils.mjs';

// ── Text helpers ─────────────────────────────────────────────────────────────

function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim() : '';
}

function normalizeTarget(value) {
  const t = normalizeText(value).toLowerCase().replace(/\.md$/, '');
  const valid = ['bootstrap', 'agent-profile', 'context-digest', 'projects', 'skills',
    'tasks', 'worklog', 'global', 'system'];
  return valid.includes(t) ? t : '';
}

function normalizeStatus(value) {
  const s = normalizeText(value).toLowerCase();
  if (s === 'superseded') return 'superseded';
  if (s === 'rejected') return 'rejected';
  return 'active';
}

function normalizeConfidence(value) {
  if (value == null) return 0.7;
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return 0.7;
  return Math.max(0, Math.min(1, Math.round(n * 1000) / 1000));
}

// ── Recency score (exponential decay, half-life ~30 days) ────────────────────

const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

export function recencyScore(isoTimestamp) {
  if (!isoTimestamp) return 0;
  const age = Date.now() - Date.parse(isoTimestamp);
  if (!Number.isFinite(age) || age < 0) return 1;
  return Math.exp((-Math.LN2 * age) / HALF_LIFE_MS);
}

// ── Composite retrieval score ────────────────────────────────────────────────
// Weights: recency 0.3, importance 0.3, relevance 0.4
// (relevance is provided by the caller as a 0–1 value)

export function retrievalScore(entry, relevance = 0) {
  const recency = recencyScore(entry.updatedAt || entry.createdAt);
  const importance = typeof entry.importance === 'number' ? entry.importance : 0.5;
  return 0.3 * recency + 0.3 * importance + 0.4 * relevance;
}

// ── JSONL I/O ────────────────────────────────────────────────────────────────

async function readAllEntries() {
  try {
    const raw = await readFile(MEMORY_STORE_FILE, 'utf8');
    const entries = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}

async function appendEntry(entry) {
  await ensureDir(join(MEMORY_STORE_FILE, '..'));
  await appendFile(MEMORY_STORE_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Write a new memory entry. If an existing active entry with the same text
 * and target exists, it is superseded rather than duplicated.
 *
 * Returns the written entry.
 */
export async function writeMemoryEntry(fields = {}) {
  const text = normalizeText(fields.text);
  const target = normalizeTarget(fields.target);
  if (!text || !target) {
    throw new Error('writeMemoryEntry: text and target are required');
  }

  const now = new Date().toISOString();
  const entries = await readAllEntries();

  // Check for exact duplicate (same text + target, still active)
  const exactDuplicate = entries.find(
    (e) => e.status === 'active' && normalizeText(e.text) === text && e.target === target,
  );
  if (exactDuplicate) {
    return exactDuplicate;
  }

  // Check for semantic conflict: same target, similar text (simple substring check)
  // If found, mark the old one as superseded
  const conflictIndex = entries.findIndex(
    (e) => e.status === 'active'
      && e.target === target
      && isSemanticallyConflicting(text, normalizeText(e.text)),
  );

  const newId = `mem_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const newEntry = {
    id: newId,
    text,
    target,
    createdAt: now,
    updatedAt: now,
    sessionId: normalizeText(fields.sessionId),
    sessionName: normalizeText(fields.sessionName),
    source: normalizeText(fields.source) || 'agent',
    type: normalizeText(fields.type),
    confidence: normalizeConfidence(fields.confidence),
    importance: normalizeConfidence(fields.importance ?? fields.confidence),
    status: 'active',
    accessCount: 0,
    lastAccessAt: null,
    ...(normalizeText(fields.reason) ? { reason: normalizeText(fields.reason) } : {}),
    ...(normalizeText(fields.expiresAt) ? { expiresAt: normalizeText(fields.expiresAt) } : {}),
  };

  if (conflictIndex >= 0) {
    // Write a supersession marker for the old entry
    const oldEntry = entries[conflictIndex];
    const supersededEntry = { ...oldEntry, status: 'superseded', supersededBy: newId, updatedAt: now };
    // Rewrite the whole file with the supersession applied
    const updatedEntries = entries.map((e, i) => (i === conflictIndex ? supersededEntry : e));
    await rewriteStore(updatedEntries);
    // Then append the new entry
    await appendEntry(newEntry);
  } else {
    await appendEntry(newEntry);
  }

  return newEntry;
}

/**
 * Load active memory entries for a given target, sorted by retrieval score.
 * relevanceScores is an optional Map<id, number> for semantic relevance.
 */
export async function loadMemoryEntries(target, { relevanceScores = null, limit = 20 } = {}) {
  const entries = await readAllEntries();
  const active = entries.filter((e) => e.status === 'active' && e.target === target);

  const scored = active.map((e) => ({
    entry: e,
    score: retrievalScore(e, relevanceScores?.get(e.id) ?? 0),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}

/**
 * Load all active entries across all targets, sorted by recency.
 */
export async function loadAllActiveEntries({ limit = 100 } = {}) {
  const entries = await readAllEntries();
  const active = entries
    .filter((e) => e.status === 'active')
    .sort((a, b) => {
      const ta = Date.parse(a.updatedAt || a.createdAt) || 0;
      const tb = Date.parse(b.updatedAt || b.createdAt) || 0;
      return tb - ta;
    });
  return active.slice(0, limit);
}

/**
 * Record that an entry was accessed (for access-frequency tracking).
 * Batches updates — does not rewrite the store immediately.
 * Call flushAccessLog() to persist.
 */
const pendingAccessUpdates = new Map();

export function recordAccess(entryId) {
  if (!entryId) return;
  const existing = pendingAccessUpdates.get(entryId) || { count: 0, lastAt: null };
  pendingAccessUpdates.set(entryId, {
    count: existing.count + 1,
    lastAt: new Date().toISOString(),
  });
}

export async function flushAccessLog() {
  if (pendingAccessUpdates.size === 0) return;
  const updates = new Map(pendingAccessUpdates);
  pendingAccessUpdates.clear();

  const entries = await readAllEntries();
  let changed = false;
  const updated = entries.map((e) => {
    const upd = updates.get(e.id);
    if (!upd) return e;
    changed = true;
    return {
      ...e,
      accessCount: (e.accessCount || 0) + upd.count,
      lastAccessAt: upd.lastAt,
      // Boost importance slightly on access (max 0.95)
      importance: Math.min(0.95, (e.importance || 0.5) + 0.02 * upd.count),
    };
  });

  if (changed) {
    await rewriteStore(updated);
  }
}

/**
 * Build a plain-text summary of active entries for a target,
 * suitable for injection into a prompt.
 * Returns entries sorted by retrieval score, formatted as bullet lines.
 */
export async function buildMemoryPromptBlock(target, { limit = 12 } = {}) {
  const entries = await loadMemoryEntries(target, { limit });
  if (entries.length === 0) return '';
  return entries.map((e) => `- ${e.text}`).join('\n');
}

/**
 * Compact the store: remove superseded/rejected entries older than retentionDays.
 * Rewrites the file.
 */
export async function compactStore({ retentionDays = 90 } = {}) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await readAllEntries();
  const kept = entries.filter((e) => {
    if (e.status === 'active') return true;
    const age = Date.parse(e.updatedAt || e.createdAt) || 0;
    return age > cutoff;
  });
  if (kept.length < entries.length) {
    await rewriteStore(kept);
  }
  return { before: entries.length, after: kept.length };
}

/**
 * Export active entries for a target back to its .md file.
 * This keeps the human-readable .md files in sync with the store.
 */
export async function syncTargetToMarkdown(target) {
  const entries = await loadMemoryEntries(target);
  if (entries.length === 0) return;

  const targetPath = resolveTargetPath(target);
  if (!targetPath) return;

  const title = TARGET_TITLES[target] || target;
  const lines = [
    `# ${title}`,
    '',
    `<!-- auto-synced from memory-store.jsonl at ${new Date().toISOString()} -->`,
    '',
    ...entries.map((e) => `- ${e.text}`),
    '',
  ];
  await ensureDir(join(targetPath, '..'));
  await writeTextAtomic(targetPath, lines.join('\n'));
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function rewriteStore(entries) {
  await ensureDir(join(MEMORY_STORE_FILE, '..'));
  const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await writeTextAtomic(MEMORY_STORE_FILE, content);
}

/**
 * Simple conflict detection: two texts conflict if one is a substantial
 * update of the other (shares key tokens, one is longer/newer version).
 * This is intentionally conservative to avoid false positives.
 */
function isSemanticallyConflicting(newText, oldText) {
  if (!newText || !oldText) return false;
  if (newText === oldText) return false;

  // If the new text starts with the same first 40 chars, it's likely an update
  const prefix = Math.min(40, Math.floor(newText.length * 0.4));
  if (prefix > 10 && oldText.startsWith(newText.slice(0, prefix))) return true;
  if (prefix > 10 && newText.startsWith(oldText.slice(0, prefix))) return true;

  return false;
}

const TARGET_TITLES = {
  bootstrap: 'Bootstrap',
  'agent-profile': 'Agent Profile',
  'context-digest': 'Context Digest',
  projects: 'Project Pointers',
  skills: 'Local Skills Index',
  tasks: 'Task Memory',
  worklog: 'Work Log',
  global: 'Global Local Notes',
  system: 'System Memory',
};

function resolveTargetPath(target) {
  const paths = {
    bootstrap: join(MEMORY_DIR, 'bootstrap.md'),
    'agent-profile': join(MEMORY_DIR, 'agent-profile.md'),
    'context-digest': join(MEMORY_DIR, 'context-digest.md'),
    projects: join(MEMORY_DIR, 'projects.md'),
    skills: join(MEMORY_DIR, 'skills.md'),
    global: join(MEMORY_DIR, 'global.md'),
  };
  return paths[target] || null;
}
