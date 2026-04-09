import { normalizeSessionTaskCard } from '../session/task-card.mjs';
import { syncSessionContinuityFromSession } from './branch-lifecycle.mjs';
import {
  createWorkbenchId,
  dedupeTexts,
  normalizeNullableText,
  nowIso,
} from './shared.mjs';
import {
  getWorkbenchSession,
  updateWorkbenchSessionTaskCard,
} from './session-ports.mjs';

function clipText(value, max = 120) {
  const text = normalizeNullableText(value);
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function toConciseText(value, max = 72) {
  const compact = normalizeNullableText(value);
  if (!compact) return '';
  const firstSegment = compact
    .split(/[。！？.!?\n]/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return clipText(firstSegment || compact, max);
}

function getSessionDisplayName(session, fallback = '当前任务') {
  const taskCard = normalizeSessionTaskCard(session?.taskCard || {}) || {};
  const lineRole = normalizeNullableText(taskCard.lineRole).toLowerCase() === 'branch' ? 'branch' : 'main';
  const name = normalizeNullableText(session?.name);
  const goal = normalizeNullableText(taskCard.goal);
  const mainGoal = normalizeNullableText(taskCard.mainGoal);
  return toConciseText(
    lineRole === 'branch'
      ? (goal || name || mainGoal || fallback)
      : (name || mainGoal || goal || fallback),
    64,
  ) || fallback;
}

function takeTaskCardList(taskCard, key, max = 3) {
  return dedupeTexts(taskCard?.[key] || []).slice(0, max);
}

function buildFallbackConclusion(taskCard, sessionTitle = '') {
  return normalizeNullableText(
    taskCard?.checkpoint
    || taskCard?.summary
    || taskCard?.goal
    || sessionTitle,
  );
}

function buildPacketSections(sourceSession = null) {
  const sourceTaskCard = normalizeSessionTaskCard(sourceSession?.taskCard || {}) || {};
  const sourceTitle = getSessionDisplayName(sourceSession, '源任务');

  const background = dedupeTexts([
    ...takeTaskCardList(sourceTaskCard, 'background', 2),
    ...takeTaskCardList(sourceTaskCard, 'rawMaterials', 2),
  ]).slice(0, 4);

  const constraints = takeTaskCardList(sourceTaskCard, 'assumptions', 3);

  const conclusions = dedupeTexts([
    ...takeTaskCardList(sourceTaskCard, 'knownConclusions', 3),
    buildFallbackConclusion(sourceTaskCard, sourceTitle)
      ? `阶段摘要：${buildFallbackConclusion(sourceTaskCard, sourceTitle)}`
      : '',
  ]).slice(0, 4);

  const nextSteps = takeTaskCardList(sourceTaskCard, 'nextSteps', 3);

  if (
    background.length === 0
    && constraints.length === 0
    && conclusions.length === 0
    && nextSteps.length === 0
  ) {
    return {
      background: [],
      constraints: [],
      conclusions: [`来自任务「${sourceTitle}」的阶段数据交接`],
      nextSteps: [],
    };
  }

  return {
    background,
    constraints,
    conclusions,
    nextSteps,
  };
}

export function buildTaskDataHandoffPacket({
  sourceSession = null,
  targetSession = null,
} = {}) {
  const createdAt = nowIso();
  const sourceTitle = getSessionDisplayName(sourceSession, '源任务');
  const targetTitle = getSessionDisplayName(targetSession, '目标任务');
  const sections = buildPacketSections(sourceSession);

  return {
    packetId: createWorkbenchId('handoff'),
    createdAt,
    sourceSessionId: normalizeNullableText(sourceSession?.id),
    targetSessionId: normalizeNullableText(targetSession?.id),
    sourceTitle,
    targetTitle,
    summary: `${sourceTitle} -> ${targetTitle}`,
    sections,
  };
}

function applyTaskDataHandoffToTaskCard(targetTaskCard = null, packet = null) {
  const current = normalizeSessionTaskCard(targetTaskCard || {}) || {};
  const sections = packet?.sections && typeof packet.sections === 'object' ? packet.sections : {};
  const sourceTitle = normalizeNullableText(packet?.sourceTitle) || '源任务';
  const handoffLine = `来自任务「${sourceTitle}」的数据交接`;

  return normalizeSessionTaskCard({
    ...current,
    checkpoint: normalizeNullableText(
      current.checkpoint
      || (Array.isArray(sections.nextSteps) ? sections.nextSteps[0] : '')
      || (Array.isArray(sections.conclusions) ? sections.conclusions[0] : '')
      || handoffLine,
    ),
    background: dedupeTexts([
      handoffLine,
      ...(Array.isArray(sections.background) ? sections.background : []),
      ...(current.background || []),
    ]),
    rawMaterials: dedupeTexts([
      `来源任务：${sourceTitle}`,
      ...(current.rawMaterials || []),
    ]),
    assumptions: dedupeTexts([
      ...(Array.isArray(sections.constraints) ? sections.constraints : []),
      ...(current.assumptions || []),
    ]),
    knownConclusions: dedupeTexts([
      ...(Array.isArray(sections.conclusions) ? sections.conclusions : []),
      ...(current.knownConclusions || []),
    ]),
    nextSteps: dedupeTexts([
      ...(Array.isArray(sections.nextSteps) ? sections.nextSteps : []),
      ...(current.nextSteps || []),
    ]),
    memory: dedupeTexts([
      `已接收来自「${sourceTitle}」的数据交接`,
      ...(current.memory || []),
    ]),
  });
}

export async function handoffSessionData(sourceSessionId, payload = {}) {
  const normalizedSourceSessionId = normalizeNullableText(sourceSessionId);
  const targetSessionId = normalizeNullableText(payload?.targetSessionId);

  if (!normalizedSourceSessionId) {
    throw new Error('sourceSessionId is required');
  }
  if (!targetSessionId) {
    throw new Error('targetSessionId is required');
  }
  if (normalizedSourceSessionId === targetSessionId) {
    throw new Error('Source and target tasks must be different');
  }

  const [sourceSession, targetSession] = await Promise.all([
    getWorkbenchSession(normalizedSourceSessionId),
    getWorkbenchSession(targetSessionId),
  ]);

  if (!sourceSession?.id) {
    throw new Error('Source session not found');
  }
  if (!targetSession?.id) {
    throw new Error('Target session not found');
  }

  const packet = buildTaskDataHandoffPacket({
    sourceSession,
    targetSession,
  });

  const nextTaskCard = applyTaskDataHandoffToTaskCard(targetSession.taskCard, packet);
  const updatedSession = await updateWorkbenchSessionTaskCard(targetSession.id, nextTaskCard);
  await syncSessionContinuityFromSession(updatedSession, {
    taskCard: updatedSession?.taskCard,
  });

  return {
    session: updatedSession,
    packet,
  };
}
