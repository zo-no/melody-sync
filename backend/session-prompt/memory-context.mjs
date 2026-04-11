import { readFile } from 'fs/promises';
import { join } from 'path';

import { MEMORY_DIR } from '../../lib/config.mjs';
import { loadMemoryEntries, loadAllActiveEntries, recordAccess } from '../memory/memory-store.mjs';

const BOOTSTRAP_MD = join(MEMORY_DIR, 'bootstrap.md');
const AGENT_PROFILE_MD = join(MEMORY_DIR, 'agent-profile.md');
const CONTEXT_DIGEST_MD = join(MEMORY_DIR, 'context-digest.md');

const MAX_MEMORY_SECTION_CHARS = 1200;

function normalizeInlineText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clipText(value, maxChars) {
  const text = normalizeInlineText(value);
  if (!text || !Number.isInteger(maxChars) || maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  if (maxChars === 1) return '…';
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

async function readOptionalText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

function extractMarkdownHighlights(markdown, { maxLines = 8, maxChars = MAX_MEMORY_SECTION_CHARS, preferRecent = false } = {}) {
  if (!markdown || typeof markdown !== 'string') return '';

  const sourceLines = markdown.replace(/\r\n/g, '\n').split('\n');
  const bulletLines = [];
  const textLines = [];

  for (const rawLine of sourceLines) {
    const line = String(rawLine || '').trim();
    if (!line || /^---$/.test(line) || /^updated_at:\s*/i.test(line)) continue;
    if (/^#{1,6}\s+/.test(line)) continue;
    if (/^<!--/.test(line)) continue;

    const bulletMatch = line.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
    if (bulletMatch) {
      const value = normalizeInlineText(bulletMatch[1]);
      if (value) bulletLines.push(`- ${value}`);
      continue;
    }

    const value = normalizeInlineText(line);
    if (value) textLines.push(value);
  }

  const pool = bulletLines.length > 0 ? bulletLines : textLines;
  if (pool.length === 0) return '';

  const deduped = [];
  const seen = new Set();
  for (const line of pool) {
    const key = normalizeInlineText(line).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(line);
  }

  const selected = preferRecent
    ? deduped.slice(Math.max(0, deduped.length - maxLines))
    : deduped.slice(0, maxLines);
  const clipped = [];

  for (const line of selected) {
    const next = clipText(line, 220);
    if (!next) continue;
    const candidateText = clipped.length === 0 ? next : `${clipped.join('\n')}\n${next}`;
    if (candidateText.length > maxChars) break;
    clipped.push(next);
  }

  return clipped.join('\n');
}

/**
 * Build a prompt block from store entries for a target.
 * Falls back to the .md file if the store has no entries for that target.
 */
async function buildTargetBlock(target, mdPath, { maxLines, maxChars, preferRecent = false } = {}) {
  try {
    const entries = await loadMemoryEntries(target, { limit: maxLines || 12 });
    if (entries.length > 0) {
      // Record access for importance boosting
      for (const e of entries) recordAccess(e.id);

      const lines = entries.map((e) => `- ${e.text}`);
      const selected = preferRecent ? lines.slice(-( maxLines || 8)) : lines.slice(0, maxLines || 8);
      const joined = selected.join('\n');
      return maxChars ? clipText(joined, maxChars) : joined;
    }
  } catch {
    // Fall through to .md fallback
  }

  // Fallback: read from .md file
  const markdown = await readOptionalText(mdPath);
  return extractMarkdownHighlights(markdown, { maxLines, maxChars, preferRecent });
}

export async function loadMemoryActivationPromptContext() {
  const [bootstrapBlock, profileBlock, digestBlock] = await Promise.all([
    buildTargetBlock('bootstrap', BOOTSTRAP_MD, { maxLines: 6, maxChars: 900 }),
    buildTargetBlock('agent-profile', AGENT_PROFILE_MD, { maxLines: 8, maxChars: 1100 }),
    buildTargetBlock('context-digest', CONTEXT_DIGEST_MD, { maxLines: 8, maxChars: 1200, preferRecent: true }),
  ]);

  return {
    bootstrapMemory: bootstrapBlock,
    profileMemory: profileBlock,
    recentContextDigest: digestBlock,
  };
}

/**
 * Load memories relevant to a specific query (simple keyword matching).
 * Used by first_user_message hook to inject contextually relevant memories.
 *
 * Returns a formatted block of the top matching entries across all targets,
 * or empty string if nothing relevant found.
 */
export async function loadRelevantMemoriesForQuery(query, { limit = 8, maxChars = 1200 } = {}) {
  if (!query || typeof query !== 'string') return '';

  try {
    const allEntries = await loadAllActiveEntries({ limit: 200 });
    if (allEntries.length === 0) return '';

    const queryTokens = query.toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);

    if (queryTokens.length === 0) return '';

    // Score each entry by keyword overlap
    const scored = allEntries.map((entry) => {
      const entryText = entry.text.toLowerCase();
      const matches = queryTokens.filter((token) => entryText.includes(token)).length;
      const relevance = matches / queryTokens.length;
      return { entry, relevance };
    }).filter((s) => s.relevance > 0);

    if (scored.length === 0) return '';

    // Sort by relevance, then recency
    scored.sort((a, b) => {
      if (Math.abs(a.relevance - b.relevance) > 0.1) return b.relevance - a.relevance;
      const ta = Date.parse(a.entry.updatedAt || a.entry.createdAt) || 0;
      const tb = Date.parse(b.entry.updatedAt || b.entry.createdAt) || 0;
      return tb - ta;
    });

    const top = scored.slice(0, limit);
    for (const { entry } of top) recordAccess(entry.id);

    const lines = top.map(({ entry }) => `- ${entry.text}`);
    const joined = lines.join('\n');
    return maxChars ? clipText(joined, maxChars) : joined;
  } catch {
    return '';
  }
}
