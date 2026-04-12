import { trimText } from './text.mjs';

/**
 * Normalize a raw persistent kind value to a canonical kind string.
 * Single source of truth for backend — all files should import from here.
 *
 * Frontend equivalent: MelodySyncTaskTypeConstants.PERSISTENT_KINDS
 * in frontend-src/core/task-type-constants.js
 */
export function normalizePersistentKind(value) {
  const normalized = trimText(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (['skill', 'long_skill', 'persistent_skill'].includes(normalized)) return 'skill';
  if (['recurring_task', 'recurring', 'periodic_task'].includes(normalized)) return 'recurring_task';
  if (['scheduled_task', 'short_term_task', 'short_task', 'short_term', 'scheduled_once', 'timed_task', 'scheduled_job'].includes(normalized)) return 'scheduled_task';
  if (['waiting_task', 'waiting', 'human_task', 'needs_user_task'].includes(normalized)) return 'waiting_task';
  return '';
}

/** Valid persistent kind values. */
export const PERSISTENT_KINDS = Object.freeze(['recurring_task', 'scheduled_task', 'waiting_task', 'skill']);

/** Default bucket for each kind. */
export const KIND_TO_BUCKET = Object.freeze({
  recurring_task: 'long_term',
  scheduled_task: 'short_term',
  waiting_task:   'waiting',
  skill:          'skill',
});
