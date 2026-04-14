#!/usr/bin/env node
/**
 * One-shot migration: chat-sessions.json → sessions.db
 *
 * Usage:
 *   node scripts/migrate-sessions-to-sqlite.mjs
 *   node scripts/migrate-sessions-to-sqlite.mjs --force   # re-migrate even if DB exists
 *
 * The server performs this migration automatically on first boot.
 * Run this script manually if you need to re-seed the DB from the JSON backup.
 */
import { existsSync } from 'fs';
import { readJson } from '../backend/fs-utils.mjs';
import { CHAT_SESSIONS_FILE, CHAT_SESSIONS_DB_FILE, CHAT_SESSIONS_INDEX_FILE } from '../lib/config.mjs';
import { openSessionDb, dbUpsertSessions, dbCountSessions } from '../backend/session/session-db.mjs';
import { writeTextAtomic } from '../backend/fs-utils.mjs';
import { buildSessionsIndexMarkdown } from '../backend/session/list-index.mjs';

const force = process.argv.includes('--force');

if (!existsSync(CHAT_SESSIONS_FILE)) {
  console.log('No chat-sessions.json found — nothing to migrate.');
  process.exit(0);
}

const db = await openSessionDb();
const existing = dbCountSessions(db);

if (existing > 0 && !force) {
  console.log(`sessions.db already has ${existing} rows. Use --force to re-migrate.`);
  process.exit(0);
}

if (force && existing > 0) {
  console.log(`--force: clearing ${existing} existing rows...`);
  db.prepare('DELETE FROM sessions').run();
}

console.log(`Reading ${CHAT_SESSIONS_FILE} ...`);
const raw = await readJson(CHAT_SESSIONS_FILE, []);
if (!Array.isArray(raw) || raw.length === 0) {
  console.log('JSON file is empty — nothing to migrate.');
  process.exit(0);
}

console.log(`Migrating ${raw.length} sessions → ${CHAT_SESSIONS_DB_FILE} ...`);
dbUpsertSessions(db, raw);

const count = dbCountSessions(db);
console.log(`Done. DB now has ${count} sessions.`);

// Regenerate SESSIONS.md
await writeTextAtomic(CHAT_SESSIONS_INDEX_FILE, buildSessionsIndexMarkdown(raw));
console.log(`SESSIONS.md updated.`);
