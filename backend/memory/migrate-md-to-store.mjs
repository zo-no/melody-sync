/**
 * One-time migration: read existing .md memory files and populate memory-store.jsonl.
 * Safe to run multiple times — writeMemoryEntry deduplicates exact matches.
 */
import { readFile } from 'fs/promises';
import { join } from 'path';

import { MEMORY_DIR } from '../../lib/config.mjs';
import { writeMemoryEntry } from './memory-store.mjs';

const TARGETS = [
  { target: 'bootstrap', file: join(MEMORY_DIR, 'bootstrap.md') },
  { target: 'agent-profile', file: join(MEMORY_DIR, 'agent-profile.md') },
  { target: 'context-digest', file: join(MEMORY_DIR, 'context-digest.md') },
  { target: 'projects', file: join(MEMORY_DIR, 'projects.md') },
  { target: 'skills', file: join(MEMORY_DIR, 'skills.md') },
  { target: 'global', file: join(MEMORY_DIR, 'global.md') },
];

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractBulletLines(markdown) {
  if (!markdown) return [];
  return markdown
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => normalizeText(line.replace(/^[-*]\s+/, '')))
    .filter(Boolean);
}

async function readOptional(path) {
  try { return await readFile(path, 'utf8'); } catch { return ''; }
}

export async function migrateMdFilesToStore({ verbose = false } = {}) {
  let total = 0;
  let written = 0;

  for (const { target, file } of TARGETS) {
    const markdown = await readOptional(file);
    const lines = extractBulletLines(markdown);
    total += lines.length;

    for (const text of lines) {
      try {
        const entry = await writeMemoryEntry({ text, target, source: 'migration', confidence: 0.8 });
        // If it returned an existing entry (dedup), don't count as written
        if (entry.source !== 'migration') continue;
        written += 1;
        if (verbose) console.log(`[migrate] ${target}: ${text.slice(0, 60)}`);
      } catch (err) {
        if (verbose) console.warn(`[migrate] ${target} skip: ${err.message}`);
      }
    }
  }

  return { total, written };
}

// Run directly: node backend/memory/migrate-md-to-store.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await migrateMdFilesToStore({ verbose: true });
  console.log(`Migration complete: ${result.written}/${result.total} entries written to store.`);
}
