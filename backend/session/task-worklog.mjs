/**
 * Task event worklog — append-only JSONL log of task lifecycle events.
 *
 * Written by pure backend code only. No AI involvement.
 * AI tasks (daily-cleanup, daily-review) read this file to do their work.
 *
 * File location: MEMORY_DIR/worklog/YYYY/MM/YYYY-MM-DD.jsonl
 * One JSON object per line, one line per event.
 *
 * Event types:
 *   triggered      — scheduled/recurring/waiting/skill triggered (scheduler or user)
 *   completed      — AI runPrompt execution finished successfully
 *   failed         — AI runPrompt execution failed or errored
 *   done           — user marked task done (clicked checkmark)
 *   deleted        — user deleted task
 *   timeout        — task auto-cleaned (midnight sweep, exceeded stale threshold)
 *   kind_changed   — task type converted (e.g. inbox → scheduled_task)
 *   waiting_created — a new waiting_task was created (by AI or user)
 */

import { appendFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { MEMORY_DIR } from '../../lib/config.mjs';
import { trimText } from './text.mjs';

const WORKLOG_DIR = join(MEMORY_DIR, 'worklog');

function buildWorklogPath(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return join(WORKLOG_DIR, year, month, `${year}-${month}-${day}.jsonl`);
}

/**
 * Append one event record to today's worklog.
 *
 * @param {string} event  - Event type (see list above)
 * @param {object} fields - Event-specific fields merged into the record
 *
 * Common fields (all events):
 *   sessionId    string   — session ID
 *   name         string   — task display name
 *   kind         string   — persistent kind (inbox / scheduled_task / recurring_task / waiting_task / skill)
 *   bucket       string   — task pool bucket
 *   projectName  string   — long-term project name, if any
 *
 * Event-specific fields:
 *   triggered:       triggerKind ('scheduled' | 'recurring' | 'manual' | 'ai')
 *   completed/failed: durationMs (number), runId (string)
 *   done:            (no extra fields)
 *   deleted:         result ('deleted'), createdAt (ISO string)
 *   timeout:         createdAt (ISO string), reason ('stale_inbox' | 'overdue_scheduled')
 *   kind_changed:    fromKind (string), toKind (string)
 *   waiting_created: parentSessionId (string), parentName (string)
 */
export async function appendTaskWorklogEvent(event, fields = {}) {
  const record = {
    event: trimText(event),
    ts: new Date().toISOString(),
    ...fields,
  };

  try {
    const path = buildWorklogPath(new Date());
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    // Non-fatal — task operations proceed regardless of worklog write failure
    console.warn('[task-worklog] Failed to append event:', err?.message || err);
  }
}

/**
 * Helper to extract common session fields for worklog records.
 */
export function extractWorklogSessionFields(session = {}) {
  return {
    sessionId: trimText(session?.id || ''),
    name: trimText(session?.name || '未命名任务'),
    kind: trimText(session?.persistent?.kind || 'inbox'),
    bucket: trimText(session?.taskPoolMembership?.longTerm?.bucket || 'inbox'),
    projectName: trimText(
      session?.sessionState?.longTerm?.rootTitle
      || session?.group
      || '',
    ) || undefined,
  };
}
