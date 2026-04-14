/**
 * SQLite-backed session metadata store.
 *
 * Schema design: stable query fields as columns + full JSON object in `data`.
 * Adding new query fields: ALTER TABLE sessions ADD COLUMN ... (backward-compatible).
 * Changing nested structures: edit the JSON in `data`, no migration needed.
 *
 * WAL mode: concurrent reads, serialized writes. No need for external serial queue.
 */
import { createRequire } from 'module';
import { dirname } from 'path';
import { CHAT_SESSIONS_DB_FILE } from '../../lib/config.mjs';
import { ensureDir } from '../fs-utils.mjs';

const require = createRequire(import.meta.url);

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id                   TEXT PRIMARY KEY NOT NULL,
  task_list_origin     TEXT,
  task_list_visibility TEXT,
  project_session_id   TEXT,
  lt_role              TEXT,
  lt_bucket            TEXT,
  workflow_state       TEXT,
  persistent_kind      TEXT,
  builtin_name         TEXT,
  pinned               INTEGER DEFAULT 0,
  created_at           TEXT,
  updated_at           TEXT,
  source_id            TEXT,
  external_trigger_id  TEXT,
  data                 TEXT NOT NULL
) STRICT;
`;

const CREATE_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_sessions_list
  ON sessions (task_list_visibility, workflow_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_project
  ON sessions (project_session_id, lt_bucket);

CREATE INDEX IF NOT EXISTS idx_sessions_persistent
  ON sessions (persistent_kind, task_list_origin);

CREATE INDEX IF NOT EXISTS idx_sessions_pinned
  ON sessions (pinned DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_external_trigger
  ON sessions (external_trigger_id)
  WHERE external_trigger_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_source
  ON sessions (source_id)
  WHERE source_id IS NOT NULL;
`;

let _db = null;

function extractColumns(meta) {
  const lt = meta?.taskPoolMembership?.longTerm;
  const createdAt = meta?.createdAt || meta?.created || '';
  return {
    id:                   String(meta?.id || ''),
    task_list_origin:     meta?.taskListOrigin || null,
    task_list_visibility: meta?.taskListVisibility || null,
    project_session_id:   lt?.projectSessionId || null,
    lt_role:              lt?.role || null,
    lt_bucket:            lt?.bucket || null,
    workflow_state:       meta?.workflowState || null,
    persistent_kind:      meta?.persistent?.kind || null,
    builtin_name:         meta?.builtinName || null,
    pinned:               meta?.pinned === true ? 1 : 0,
    created_at:           createdAt || null,
    updated_at:           meta?.updatedAt || createdAt || null,
    source_id:            meta?.sourceId || null,
    external_trigger_id:  meta?.externalTriggerId || null,
  };
}

export async function openSessionDb() {
  if (_db) return _db;
  await ensureDir(dirname(CHAT_SESSIONS_DB_FILE));
  const Database = require('better-sqlite3');
  const db = new Database(CHAT_SESSIONS_DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_TABLE_SQL);
  db.exec(CREATE_INDEXES_SQL);
  _db = db;
  return db;
}

export function getSessionDb() {
  return _db;
}

/** Load all sessions ordered by pinned desc, updated_at desc. */
export function dbLoadAllSessions(db) {
  return db.prepare(
    'SELECT data FROM sessions ORDER BY pinned DESC, updated_at DESC',
  ).all().map((row) => JSON.parse(row.data));
}

/** Get one session by id. */
export function dbGetSession(db, id) {
  const row = db.prepare('SELECT data FROM sessions WHERE id = ?').get(id);
  return row ? JSON.parse(row.data) : null;
}

/** Find session by external trigger id (non-archived). */
export function dbFindByExternalTriggerId(db, externalTriggerId) {
  const row = db.prepare(
    "SELECT data FROM sessions WHERE external_trigger_id = ? AND (workflow_state IS NULL OR workflow_state != 'done')",
  ).get(externalTriggerId);
  return row ? JSON.parse(row.data) : null;
}

/** Upsert a single session. */
export function dbUpsertSession(db, meta) {
  const cols = extractColumns(meta);
  db.prepare(`
    INSERT INTO sessions (
      id, task_list_origin, task_list_visibility,
      project_session_id, lt_role, lt_bucket,
      workflow_state, persistent_kind, builtin_name,
      pinned, created_at, updated_at,
      source_id, external_trigger_id, data
    ) VALUES (
      @id, @task_list_origin, @task_list_visibility,
      @project_session_id, @lt_role, @lt_bucket,
      @workflow_state, @persistent_kind, @builtin_name,
      @pinned, @created_at, @updated_at,
      @source_id, @external_trigger_id, @data
    )
    ON CONFLICT(id) DO UPDATE SET
      task_list_origin     = excluded.task_list_origin,
      task_list_visibility = excluded.task_list_visibility,
      project_session_id   = excluded.project_session_id,
      lt_role              = excluded.lt_role,
      lt_bucket            = excluded.lt_bucket,
      workflow_state       = excluded.workflow_state,
      persistent_kind      = excluded.persistent_kind,
      builtin_name         = excluded.builtin_name,
      pinned               = excluded.pinned,
      created_at           = excluded.created_at,
      updated_at           = excluded.updated_at,
      source_id            = excluded.source_id,
      external_trigger_id  = excluded.external_trigger_id,
      data                 = excluded.data
  `).run({ ...cols, data: JSON.stringify(meta) });
}

/** Upsert many sessions in a single transaction. */
export function dbUpsertSessions(db, metas) {
  const upsertMany = db.transaction((list) => {
    for (const meta of list) dbUpsertSession(db, meta);
  });
  upsertMany(metas);
}

/** Delete a session by id. */
export function dbDeleteSession(db, id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

/** Count all sessions. */
export function dbCountSessions(db) {
  return db.prepare('SELECT COUNT(*) as n FROM sessions').get().n;
}
