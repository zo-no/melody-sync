/**
 * Shared text-normalization helpers for the session domain.
 * Extracted from repeated local definitions across session/*.mjs files.
 */

/** Trim leading/trailing whitespace; return '' for non-strings. */
export function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Collapse internal whitespace runs and trim; return '' for non-strings. */
export function collapseText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Normalize line endings, trim; handles null/undefined. */
export function normalizeText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}
