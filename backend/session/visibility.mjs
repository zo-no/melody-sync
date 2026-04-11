import { trimText } from './text.mjs';

export function normalizeSessionTaskListOrigin(value) {
  const normalized = trimText(value).toLowerCase();
  if (normalized === 'assistant') return 'assistant';
  if (normalized === 'system') return 'system';
  return normalized === 'user' ? 'user' : '';
}

export function normalizeSessionTaskListVisibility(value) {
  const normalized = trimText(value).toLowerCase();
  if (normalized === 'secondary') return 'secondary';
  if (normalized === 'hidden') return 'hidden';
  return normalized === 'primary' ? 'primary' : '';
}

export function getInternalSessionRole(meta) {
  return typeof meta?.internalRole === 'string' ? meta.internalRole.trim() : '';
}

export function isInternalSession(meta) {
  return !!getInternalSessionRole(meta);
}

export function isContextCompactorSession(meta, contextCompactorRole = 'context_compactor') {
  return getInternalSessionRole(meta) === contextCompactorRole;
}

function isOrganizerSkillSession(meta) {
  const normalizedName = trimText(meta?.name).toLowerCase();
  const systemPrompt = trimText(meta?.systemPrompt);
  return normalizedName === 'sort session list'
    || systemPrompt.includes("You are MelodySync's hidden session-list organizer.");
}

function isAssistantChildSession(meta) {
  return !!trimText(meta?.forkedFromSessionId)
    || !!trimText(meta?.sourceContext?.parentSessionId)
    || /^delegate\s*-\s*opportunity:/i.test(trimText(meta?.name));
}

export function getSessionTaskListOrigin(meta) {
  const explicit = normalizeSessionTaskListOrigin(meta?.taskListOrigin);
  if (explicit) return explicit;
  if (isInternalSession(meta)) return 'system';
  if (isOrganizerSkillSession(meta)) return 'system';
  if (isAssistantChildSession(meta)) return 'assistant';
  return 'user';
}

export function getSessionTaskListVisibility(meta) {
  const explicit = normalizeSessionTaskListVisibility(meta?.taskListVisibility);
  if (explicit) return explicit;
  if (isInternalSession(meta)) return 'hidden';
  if (isOrganizerSkillSession(meta)) return 'hidden';
  if (isAssistantChildSession(meta)) return 'secondary';
  return 'primary';
}

export function shouldExposeSession(meta) {
  return !isInternalSession(meta) && getSessionTaskListVisibility(meta) !== 'hidden';
}

export function shouldIncludeSessionInPrimaryTaskList(meta) {
  return shouldExposeSession(meta) && getSessionTaskListVisibility(meta) === 'primary';
}
