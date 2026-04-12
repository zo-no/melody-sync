import { trimText } from './text.mjs';
// NOTE: Keep alias lists in sync with frontend-src/core/task-type-constants.js normalizeBucket()

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

/**
 * Normalize a raw bucket string to a canonical bucket key.
 * Handles aliases, Chinese labels, and legacy values.
 */
export function normalizeLongTermBucket(value) {
  const normalized = trimText(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (['inbox', 'collection', 'collect', 'capture', '收集箱'].includes(normalized)) return 'inbox';
  if (['short_term_iteration', 'short_term', 'short', 'iteration', '短期迭代', '短期任务'].includes(normalized)) return 'short_term';
  if (['long_term_iteration', 'long_term', 'long', '长期迭代', '长期任务'].includes(normalized)) return 'long_term';
  if (['waiting', 'waiting_for', 'waiting_user', '等待任务', '等待'].includes(normalized)) return 'waiting';
  if (['skill', 'quick_action', 'quick-action', '快捷按钮', '快捷动作'].includes(normalized)) return 'skill';
  return '';
}

/**
 * Infer the long-term bucket for a session.
 * Priority: explicit membership bucket > kind > workflowState > inbox
 */
export function inferLongTermBucketFromSession(session = null, persistent = null) {
  const explicitBucket = normalizeLongTermBucket(session?.taskPoolMembership?.longTerm?.bucket || '');
  if (explicitBucket) return explicitBucket;
  const kind = normalizePersistentKind(persistent?.kind || session?.persistent?.kind || '');
  if (KIND_TO_BUCKET[kind]) return KIND_TO_BUCKET[kind];
  const workflowState = trimText(session?.workflowState || '').toLowerCase();
  if (workflowState === 'waiting_user') return 'waiting';
  return 'inbox';
}
