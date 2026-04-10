import { randomUUID } from 'crypto';

import { WORKBENCH_MEMORY_CANDIDATES_FILE } from '../../lib/config.mjs';
import { readJson, writeJsonAtomic } from '../fs-utils.mjs';

function normalizeText(value) {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').trim()
    : '';
}

function normalizeCandidateStatus(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return 'candidate';
  if (['candidate', 'suggested', 'pending', 'review'].includes(normalized)) return 'candidate';
  if (['approved', 'approve', 'promoted'].includes(normalized)) return 'approved';
  if (['active', 'applied', 'writeback'].includes(normalized)) return 'active';
  if (['rejected', 'reject', 'dismissed'].includes(normalized)) return 'rejected';
  if (['invalidated', 'invalid', 'superseded'].includes(normalized)) return 'invalidated';
  if (['expired', 'stale'].includes(normalized)) return 'expired';
  return 'candidate';
}

function normalizeConfidence(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value).trim());
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return Math.round(numeric * 1000) / 1000;
}

function normalizeCandidateItem(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = normalizeText(value.id) || `memcand_${randomUUID()}`;
  const sessionId = normalizeText(value.sessionId);
  const text = normalizeText(value.text);
  if (!sessionId || !text) return null;
  const createdAt = normalizeText(value.createdAt) || new Date().toISOString();
  const updatedAt = normalizeText(value.updatedAt) || createdAt;
  return {
    id,
    sessionId,
    sessionName: normalizeText(value.sessionName),
    scope: normalizeText(value.scope) === 'user' ? 'user' : 'project',
    text,
    source: normalizeText(value.source) || 'agent',
    target: normalizeText(value.target),
    type: normalizeText(value.type),
    status: normalizeCandidateStatus(value.status),
    ...(normalizeConfidence(value.confidence) !== null ? { confidence: normalizeConfidence(value.confidence) } : {}),
    ...(normalizeText(value.reason) ? { reason: normalizeText(value.reason) } : {}),
    ...(normalizeText(value.expiresAt) ? { expiresAt: normalizeText(value.expiresAt) } : {}),
    createdAt,
    updatedAt,
  };
}

function sortByUpdatedDesc(items = []) {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left?.updatedAt || left?.createdAt || '') || 0;
    const rightTime = Date.parse(right?.updatedAt || right?.createdAt || '') || 0;
    return rightTime - leftTime;
  });
}

function normalizeStore(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeCandidateItem(item))
    .filter(Boolean);
}

export async function loadWorkbenchMemoryCandidates() {
  return normalizeStore(await readJson(WORKBENCH_MEMORY_CANDIDATES_FILE, []));
}

export async function saveWorkbenchMemoryCandidates(items) {
  await writeJsonAtomic(WORKBENCH_MEMORY_CANDIDATES_FILE, normalizeStore(items));
}

export async function stageWorkbenchMemoryCandidate(candidate = {}) {
  const nextCandidate = normalizeCandidateItem(candidate);
  if (!nextCandidate) {
    throw new Error('sessionId and text are required to stage a memory candidate');
  }

  const items = await loadWorkbenchMemoryCandidates();
  const existingIndex = items.findIndex((entry) => (
    entry.sessionId === nextCandidate.sessionId
    && entry.text === nextCandidate.text
    && entry.target === nextCandidate.target
    && entry.status === 'candidate'
  ));

  if (existingIndex >= 0) {
    const existing = items[existingIndex];
    items[existingIndex] = normalizeCandidateItem({
      ...existing,
      ...nextCandidate,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    });
  } else {
    items.push(nextCandidate);
  }

  await saveWorkbenchMemoryCandidates(items);
  return existingIndex >= 0 ? items[existingIndex] : nextCandidate;
}

export async function listWorkbenchMemoryCandidatesForSession(sessionId, options = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  if (!normalizedSessionId) {
    throw new Error('sessionId is required');
  }
  const includeResolved = options.includeResolved === true;
  const items = await loadWorkbenchMemoryCandidates();
  return sortByUpdatedDesc(items.filter((entry) => (
    entry.sessionId === normalizedSessionId
    && (includeResolved || !['approved', 'active', 'rejected', 'invalidated', 'expired'].includes(entry.status))
  )));
}

export async function updateWorkbenchMemoryCandidateStatus(sessionId, candidateId, status, extras = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const normalizedCandidateId = normalizeText(candidateId);
  const normalizedStatus = normalizeCandidateStatus(status);
  if (!normalizedSessionId) throw new Error('sessionId is required');
  if (!normalizedCandidateId) throw new Error('candidateId is required');

  const items = await loadWorkbenchMemoryCandidates();
  const index = items.findIndex((entry) => (
    entry.sessionId === normalizedSessionId
    && entry.id === normalizedCandidateId
  ));
  if (index === -1) {
    throw new Error('Memory candidate not found');
  }

  const current = items[index];
  const next = normalizeCandidateItem({
    ...current,
    ...extras,
    status: normalizedStatus,
    updatedAt: new Date().toISOString(),
  });
  items[index] = next;
  await saveWorkbenchMemoryCandidates(items);
  return next;
}
