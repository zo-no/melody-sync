import { loadHistory } from './history.mjs';
import { buildSessionDisplayEvents } from './session-display-events.mjs';

export const SESSION_ORGANIZER_INTERNAL_OPERATION = 'session_organize';

const MAX_ORGANIZER_TRANSCRIPT_ITEMS = 16;
const MAX_ORGANIZER_MESSAGE_CHARS = 320;
const MAX_ORGANIZER_STATUS_CHARS = 180;

function clipText(value, maxChars) {
  const text = typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim()
    : '';
  if (!text || !Number.isInteger(maxChars) || maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  if (maxChars === 1) return '…';
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function normalizeOrganizerText(value) {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').trim()
    : '';
}

function parseJsonObjectText(modelText) {
  const text = typeof modelText === 'string' ? modelText.trim() : '';
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function simplifyOrganizerEvent(event) {
  if (!event || typeof event !== 'object') return null;
  if (event.type === 'message') {
    return {
      type: 'message',
      role: event.role === 'user' ? 'user' : 'assistant',
      content: clipText(event.content || '', MAX_ORGANIZER_MESSAGE_CHARS),
    };
  }
  if (event.type === 'status' && event.content) {
    return {
      type: 'status',
      content: clipText(event.content, MAX_ORGANIZER_STATUS_CHARS),
    };
  }
  return null;
}

async function buildOrganizerTranscriptSnapshot(sessionId) {
  const history = await loadHistory(sessionId, { includeBodies: true });
  const displayEvents = buildSessionDisplayEvents(history, { sessionRunning: false });
  return displayEvents
    .map(simplifyOrganizerEvent)
    .filter(Boolean)
    .slice(-MAX_ORGANIZER_TRANSCRIPT_ITEMS);
}

function buildOrganizerPayload(session, transcript) {
  return {
    sessionId: session?.id || '',
    existingName: clipText(session?.name || '', 120),
    existingGroup: clipText(session?.group || '', 80),
    existingDescription: clipText(session?.description || '', 200),
    existingWorkflowState: clipText(session?.workflowState || '', 40),
    existingWorkflowPriority: clipText(session?.workflowPriority || '', 40),
    folder: clipText(session?.folder || '', 160),
    tool: clipText(session?.tool || '', 40),
    sourceName: clipText(session?.sourceName || '', 80),
    messageCount: Number.isInteger(session?.messageCount) ? session.messageCount : 0,
    created: clipText(session?.created || '', 40),
    updatedAt: clipText(session?.updatedAt || '', 40),
    transcript: Array.isArray(transcript) ? transcript : [],
  };
}

export async function buildSessionOrganizerPrompt(session) {
  const transcript = await buildOrganizerTranscriptSnapshot(session?.id || '');
  const payload = buildOrganizerPayload(session, transcript);
  return [
    'You are MelodySync\'s explicit session organizer.',
    'This runs only when the owner explicitly triggers "organize task" for one session.',
    'Do not answer the user, continue the task, suggest branches, or modify the transcript.',
    'Update durable session metadata only: name, group, description, workflowState, workflowPriority.',
    'Leave any field as an empty string when it should stay unchanged.',
    'Rename only when the current title is generic, stale, or clearly weaker than the transcript summary.',
    'Keep group and description concise and stable. Do not over-classify.',
    'Allowed workflowState values: "", "waiting_user", "parked", "done".',
    'Allowed workflowPriority values: "", "high", "medium", "low".',
    'Return only one JSON object with keys: name, group, description, workflowState, workflowPriority, reason.',
    '',
    '<session_organizer_input>',
    JSON.stringify(payload, null, 2),
    '</session_organizer_input>',
  ].join('\n');
}

export function extractSessionOrganizerAssistantText(events = []) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.type === 'message' && event.role === 'assistant')
    .map((event) => normalizeOrganizerText(event.content || ''))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export function parseSessionOrganizerResult(content) {
  const parsed = parseJsonObjectText(content);
  return {
    ok: !!parsed && typeof parsed === 'object',
    name: clipText(parsed?.name || '', 120),
    group: clipText(parsed?.group || '', 80),
    description: clipText(parsed?.description || '', 240),
    workflowState: clipText(parsed?.workflowState || '', 40),
    workflowPriority: clipText(parsed?.workflowPriority || '', 40),
    reason: clipText(parsed?.reason || '', 240),
  };
}
