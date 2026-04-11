/**
 * Parse a query string value from parsedUrl.query.
 * Handles both string and array values (node's url.parse returns arrays
 * for repeated params). Returns a trimmed string or the fallback.
 */
export function getQueryValue(value, fallback = '') {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : fallback;
  }
  return typeof value === 'string' ? value.trim() : fallback;
}
