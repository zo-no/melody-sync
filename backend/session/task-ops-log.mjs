/**
 * Task operation log — append-only JSONL at logs/task-ops.jsonl
 *
 * Each line is a JSON object:
 *   { ts, sessionId, op, from, to, meta }
 *
 * op values:
 *   archive          archived true/false
 *   pin              pinned true/false
 *   rename           name changed
 *   workflow_state   workflowState changed (active/done/waiting_user/parked)
 *   workflow_priority workflowPriority changed
 *   bucket           longTerm.bucket changed (inbox/long_term/short_term/waiting/skill)
 *   project          longTerm.projectSessionId changed
 *   task_card        taskCard fields updated (checkpoint/goal/knownConclusions etc.)
 *   run_start        a run was started (source: manual/schedule/recurring/branch/voice/...)
 *   run_end          a run completed/failed/cancelled
 */

import { appendFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { TASK_OPS_LOG_FILE } from '../../lib/config.mjs';

let _ensured = false;

async function ensureDir() {
  if (_ensured) return;
  try {
    await mkdir(dirname(TASK_OPS_LOG_FILE), { recursive: true });
    _ensured = true;
  } catch {
    _ensured = true; // don't retry on every write
  }
}

/**
 * Append one operation record.
 * @param {string} sessionId
 * @param {string} op  - operation type (see above)
 * @param {*} from     - previous value (null if not applicable)
 * @param {*} to       - new value
 * @param {object} [meta] - optional extra context
 */
export async function appendTaskOp(sessionId, op, from, to, meta = null) {
  if (!sessionId || !op) return;
  const record = {
    ts: new Date().toISOString(),
    sessionId,
    op,
    from: from ?? null,
    to: to ?? null,
  };
  if (meta && typeof meta === 'object') {
    record.meta = meta;
  }
  try {
    await ensureDir();
    await appendFile(TASK_OPS_LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch {
    // best-effort — never throw
  }
}
