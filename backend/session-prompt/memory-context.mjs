import { readFile } from 'fs/promises';
import { join } from 'path';

import { MEMORY_DIR } from '../../lib/config.mjs';

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

export async function loadMemoryActivationPromptContext() {
  const [bootstrapMarkdown, agentProfileMarkdown, contextDigestMarkdown] = await Promise.all([
    readOptionalText(BOOTSTRAP_MD),
    readOptionalText(AGENT_PROFILE_MD),
    readOptionalText(CONTEXT_DIGEST_MD),
  ]);

  return {
    bootstrapMemory: extractMarkdownHighlights(bootstrapMarkdown, {
      maxLines: 6,
      maxChars: 900,
    }),
    profileMemory: extractMarkdownHighlights(agentProfileMarkdown, {
      maxLines: 8,
      maxChars: 1100,
    }),
    recentContextDigest: extractMarkdownHighlights(contextDigestMarkdown, {
      maxLines: 8,
      maxChars: 1200,
      preferRecent: true,
    }),
  };
}
