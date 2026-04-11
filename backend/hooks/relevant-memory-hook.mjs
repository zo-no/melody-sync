/**
 * Hook: session.first_user_message
 *
 * When the first real user message arrives, search the memory store for
 * entries relevant to the message text and inject them as a hidden
 * template_context event so the Agent sees them in the continuation context.
 *
 * This replaces the "fixed 3-file injection" with targeted retrieval:
 * instead of always injecting the first N lines of bootstrap/profile/digest,
 * we surface the entries most relevant to what the user is actually asking.
 */
import { loadRelevantMemoriesForQuery } from '../session-prompt/memory-context.mjs';
import { flushAccessLog } from '../memory/memory-store.mjs';

function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim() : '';
}

export async function relevantMemoryHook({ sessionId, session, recordedUserText, appendEvent, statusEvent } = {}) {
  if (!sessionId || !appendEvent || !statusEvent) return;

  const query = normalizeText(recordedUserText);
  if (!query) return;

  try {
    const block = await loadRelevantMemoriesForQuery(query, { limit: 8, maxChars: 1000 });
    if (!block) return;

    await appendEvent(sessionId, {
      type: 'template_context',
      role: 'system',
      templateName: 'relevant-memory',
      content: `[Relevant memory for this session]\n\n${block}`,
    });

    // Flush access log updates (importance boosting) in background
    flushAccessLog().catch(() => {});
  } catch {
    // Non-critical — don't break message submission on memory errors
  }
}
