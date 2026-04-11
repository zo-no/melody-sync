#!/usr/bin/env node
import assert from 'assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// Isolated temp dir
const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'melodysync-mem-store-'));
process.env.HOME = tempHome;
process.env.MELODYSYNC_MEMORY_DIR = path.join(tempHome, 'memory');
await fs.mkdir(process.env.MELODYSYNC_MEMORY_DIR, { recursive: true });

const {
  writeMemoryEntry,
  loadMemoryEntries,
  loadAllActiveEntries,
  recencyScore,
  retrievalScore,
  compactStore,
  recordAccess,
  flushAccessLog,
} = await import('../backend/memory/memory-store.mjs');

// ── recencyScore ──────────────────────────────────────────────────────────────
{
  const now = new Date().toISOString();
  assert.ok(recencyScore(now) > 0.99, 'brand-new entry should have near-1 recency');

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const score30 = recencyScore(thirtyDaysAgo);
  assert.ok(score30 > 0.45 && score30 < 0.55, '30-day-old entry should be ~0.5 (half-life)');

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  assert.ok(recencyScore(ninetyDaysAgo) < 0.15, '90-day-old entry should score low');

  assert.equal(recencyScore(null), 0, 'null timestamp should score 0');
}

// ── writeMemoryEntry: basic write ─────────────────────────────────────────────
const e1 = await writeMemoryEntry({ text: 'User prefers dark mode', target: 'agent-profile', confidence: 0.9 });
assert.ok(e1.id.startsWith('mem_'), 'id should start with mem_');
assert.equal(e1.text, 'User prefers dark mode');
assert.equal(e1.target, 'agent-profile');
assert.equal(e1.status, 'active');
assert.ok(e1.createdAt, 'createdAt should be set');
assert.equal(e1.accessCount, 0);

// ── writeMemoryEntry: exact duplicate returns existing ────────────────────────
const e1dup = await writeMemoryEntry({ text: 'User prefers dark mode', target: 'agent-profile' });
assert.equal(e1dup.id, e1.id, 'exact duplicate should return the existing entry');

// ── writeMemoryEntry: different target = different entry ──────────────────────
const e2 = await writeMemoryEntry({ text: 'User prefers dark mode', target: 'bootstrap' });
assert.notEqual(e2.id, e1.id, 'same text in different target should be a new entry');

// ── writeMemoryEntry: missing text or target throws ──────────────────────────
await assert.rejects(
  () => writeMemoryEntry({ text: '', target: 'bootstrap' }),
  /text and target are required/,
);
await assert.rejects(
  () => writeMemoryEntry({ text: 'hello', target: 'unknown-target' }),
  /text and target are required/,
);

// ── loadMemoryEntries: returns active entries for target ──────────────────────
await writeMemoryEntry({ text: 'Repo: ~/code/melody-sync', target: 'projects' });
await writeMemoryEntry({ text: 'Repo: ~/Desktop/daily-system', target: 'projects' });

const projectEntries = await loadMemoryEntries('projects');
assert.equal(projectEntries.length, 2, 'should return both project entries');

const agentEntries = await loadMemoryEntries('agent-profile');
assert.equal(agentEntries.length, 1, 'should return only agent-profile entries');

// ── loadAllActiveEntries: returns all active across targets ───────────────────
const all = await loadAllActiveEntries();
assert.ok(all.length >= 4, 'should have at least 4 active entries');
assert.ok(all.every((e) => e.status === 'active'), 'all returned entries should be active');

// ── writeMemoryEntry: conflict detection supersedes old entry ─────────────────
const e3 = await writeMemoryEntry({
  text: 'Repo: ~/code/melody-sync — main MelodySync repo, active',
  target: 'projects',
});
// The new entry starts with the same prefix as an existing one
const allAfter = await loadAllActiveEntries();
const projectsAfter = allAfter.filter((e) => e.target === 'projects');
// The conflicting old entry should be superseded; new one is active
const supersededCount = (await (async () => {
  const { readFile } = await import('fs/promises');
  const { MEMORY_STORE_FILE } = await import('../lib/config.mjs');
  const raw = await readFile(MEMORY_STORE_FILE, 'utf8').catch(() => '');
  return raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
    .filter((e) => e.status === 'superseded').length;
})());
assert.ok(supersededCount >= 1, 'conflicting entry should be superseded');
assert.equal(e3.status, 'active', 'new entry should be active');

// ── retrievalScore: higher relevance → higher score ───────────────────────────
const highRelevance = retrievalScore(e1, 0.9);
const lowRelevance = retrievalScore(e1, 0.1);
assert.ok(highRelevance > lowRelevance, 'higher relevance should produce higher score');

// ── recordAccess + flushAccessLog ─────────────────────────────────────────────
recordAccess(e1.id);
recordAccess(e1.id);
await flushAccessLog();

const updatedEntries = await loadMemoryEntries('agent-profile');
const updated = updatedEntries.find((e) => e.id === e1.id);
assert.equal(updated.accessCount, 2, 'accessCount should be 2 after two accesses');
assert.ok(updated.importance > e1.importance, 'importance should increase after access');
assert.ok(updated.lastAccessAt, 'lastAccessAt should be set');

// ── compactStore: removes old superseded entries ──────────────────────────────
const beforeCompact = await loadAllActiveEntries();
const result = await compactStore({ retentionDays: 0 }); // remove all non-active immediately
assert.ok(result.before >= result.after, 'compact should not increase entry count');

console.log('test-memory-store: ok');
