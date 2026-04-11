/**
 * Hook: run.completed
 *
 * Independent memory consolidation — extracts durable knowledge from the
 * taskCard without relying on the Agent to generate memoryCandidates.
 *
 * What gets written:
 *
 * 1. knownConclusions (new ones only) → context-digest
 *    Decisions and confirmed facts that weren't in the previous taskCard.
 *
 * 2. checkpoint (if changed) → context-digest
 *    The current "where we are" hint for resuming later.
 *
 * 3. memory[] (each item) → agent-profile
 *    Durable user preferences the Agent explicitly flagged for long-term storage.
 *
 * 4. goal / mainGoal (first run of a session only) → projects
 *    Records what the session was trying to accomplish, useful for future
 *    "find sessions about X" routing.
 *
 * All writes go through writeMemoryEntry() which handles deduplication,
 * conflict detection, and supersession — so running this hook multiple
 * times is safe.
 */
import { writeMemoryEntry } from '../memory/memory-store.mjs';

function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim() : '';
}

function normalizeList(value) {
  return Array.isArray(value)
    ? value.map((v) => normalizeText(v)).filter(Boolean)
    : [];
}

function isFirstRun(run) {
  // Heuristic: if the run has no prior run siblings we can check,
  // treat it as the first run if the session's message count is low.
  // The hook context doesn't expose full history, so we use runSeq if available.
  const seq = run?.runSeq ?? run?.seq;
  if (typeof seq === 'number') return seq <= 1;
  return false;
}

export async function memoryConsolidationHook({
  sessionId,
  session,
  run,
  taskCard,
  previousTaskCard,
  manifest,
} = {}) {
  // Skip internal operations (auto-naming, compaction, etc.)
  if (manifest?.internalOperation) return;
  if (!sessionId || !taskCard) return;

  const sessionName = normalizeText(session?.name || '');
  const baseFields = {
    sessionId,
    sessionName,
    source: 'consolidation',
    confidence: 0.75,
  };

  const writes = [];

  // ── 1. New knownConclusions → context-digest ──────────────────────────────
  const prevConclusions = new Set(
    normalizeList(previousTaskCard?.knownConclusions).map((s) => s.toLowerCase()),
  );
  const newConclusions = normalizeList(taskCard.knownConclusions).filter(
    (text) => !prevConclusions.has(text.toLowerCase()),
  );
  for (const text of newConclusions) {
    writes.push(writeMemoryEntry({
      ...baseFields,
      text,
      target: 'context-digest',
      type: 'conclusion',
      confidence: 0.8,
      importance: 0.8,
    }));
  }

  // ── 2. Checkpoint (if changed) → context-digest ──────────────────────────
  const newCheckpoint = normalizeText(taskCard.checkpoint);
  const prevCheckpoint = normalizeText(previousTaskCard?.checkpoint);
  if (newCheckpoint && newCheckpoint !== prevCheckpoint) {
    writes.push(writeMemoryEntry({
      ...baseFields,
      text: newCheckpoint,
      target: 'context-digest',
      type: 'checkpoint',
      confidence: 0.7,
      importance: 0.7,
    }));
  }

  // ── 3. memory[] items → agent-profile ────────────────────────────────────
  const prevMemory = new Set(
    normalizeList(previousTaskCard?.memory).map((s) => s.toLowerCase()),
  );
  const newMemoryItems = normalizeList(taskCard.memory).filter(
    (text) => !prevMemory.has(text.toLowerCase()),
  );
  for (const text of newMemoryItems) {
    writes.push(writeMemoryEntry({
      ...baseFields,
      text,
      target: 'agent-profile',
      type: 'preference',
      confidence: 0.85,
      importance: 0.85,
    }));
  }

  // ── 4. Goal (first run only) → projects ──────────────────────────────────
  if (isFirstRun(run)) {
    const goal = normalizeText(taskCard.mainGoal || taskCard.goal);
    if (goal) {
      writes.push(writeMemoryEntry({
        ...baseFields,
        text: `[${sessionName || sessionId}] ${goal}`,
        target: 'projects',
        type: 'session-goal',
        confidence: 0.65,
        importance: 0.6,
      }));
    }
  }

  if (writes.length === 0) return;

  // Fire all writes concurrently; individual failures are non-fatal
  const results = await Promise.allSettled(writes);
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    for (const f of failures) {
      console.error(`[memory-consolidation] ${sessionId}: ${f.reason?.message ?? f.reason}`);
    }
  }
}
