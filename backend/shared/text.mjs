/**
 * Shared text-normalization helpers for the entire backend.
 * Re-exports from session/text.mjs so all domains can use a single source.
 *
 * trimText(value)    — trim whitespace; '' for non-strings
 * collapseText(value) — collapse internal whitespace runs + trim
 * normalizeText(value) — normalize CRLF line endings + trim; handles null/undefined
 */
export { trimText, collapseText, normalizeText } from '../session/text.mjs';
