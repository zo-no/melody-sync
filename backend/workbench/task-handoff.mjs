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

const HANDOFF_DETAIL_LIMITS = Object.freeze({
  focused: Object.freeze({
    focus: 2,
    background: 2,
    constraints: 2,
    conclusions: 2,
    nextSteps: 2,
    integration: 2,
  }),
  balanced: Object.freeze({
    focus: 2,
    background: 3,
    constraints: 3,
    conclusions: 3,
    nextSteps: 3,
    integration: 2,
  }),
  full: Object.freeze({
    focus: 3,
    background: 4,
    constraints: 4,
    conclusions: 4,
    nextSteps: 4,
    integration: 3,
  }),
});

const HANDOFF_STOP_TOKENS = new Set([
  '任务',
  '当前',
  '当前任务',
  '目标',
  '目标任务',
  '主线',
  '支线',
  '继续',
  '推进',
  '整理',
  '处理',
  '阶段',
  '总结',
  '摘要',
  '背景',
  '下一步',
  '结论',
]);

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

function resolveHandoffDetailLevel(value) {
  const detailLevel = normalizeNullableText(value).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(HANDOFF_DETAIL_LIMITS, detailLevel)) {
    return detailLevel;
  }
  return 'balanced';
}

function getHandoffDetailLimits(detailLevel = 'balanced') {
  return HANDOFF_DETAIL_LIMITS[resolveHandoffDetailLevel(detailLevel)] || HANDOFF_DETAIL_LIMITS.balanced;
}

function takeContextSeedList(taskCard, key, max = 2) {
  return takeTaskCardList(taskCard, key, max);
}

function buildSessionContextSummary(session = null, fallback = '当前任务') {
  const taskCard = normalizeSessionTaskCard(session?.taskCard || {}) || {};
  return {
    title: getSessionDisplayName(session, fallback),
    goal: normalizeNullableText(taskCard.goal),
    mainGoal: normalizeNullableText(taskCard.mainGoal),
    checkpoint: normalizeNullableText(taskCard.checkpoint),
    summary: normalizeNullableText(taskCard.summary),
    nextSteps: takeContextSeedList(taskCard, 'nextSteps', 2),
    knownConclusions: takeContextSeedList(taskCard, 'knownConclusions', 2),
  };
}

function buildComparableTokenSet(value) {
  const text = normalizeNullableText(value).toLowerCase();
  if (!text) return new Set();

  const tokens = new Set();
  const asciiTokens = text.match(/[a-z0-9]{2,}/g) || [];
  for (const token of asciiTokens) {
    if (tokens.size >= 72) break;
    if (HANDOFF_STOP_TOKENS.has(token)) continue;
    tokens.add(token);
  }

  const compact = text
    .replace(/\s+/g, '')
    .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff]+/gu, '');
  const cjk = compact.replace(/[^\u4e00-\u9fff]/g, '');
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= cjk.length - size; index += 1) {
      if (tokens.size >= 72) break;
      const token = cjk.slice(index, index + size);
      if (!token || HANDOFF_STOP_TOKENS.has(token)) continue;
      tokens.add(token);
    }
  }

  return tokens;
}

function buildIntentProfile(items = []) {
  const profile = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    for (const token of buildComparableTokenSet(item)) {
      profile.add(token);
    }
  }
  return profile;
}

function scoreTextAgainstProfile(text, profile) {
  if (!text || !(profile instanceof Set) || profile.size === 0) return 0;
  let score = 0;
  for (const token of buildComparableTokenSet(text)) {
    if (!profile.has(token)) continue;
    score += token.length >= 3 ? 2 : 1;
  }
  return score;
}

function prioritizeTexts(items, profile, max = 3) {
  const normalized = dedupeTexts(items || []);
  if (normalized.length === 0) return [];
  if (!(profile instanceof Set) || profile.size === 0) {
    return normalized.slice(0, max);
  }

  const scored = normalized.map((item, index) => ({
    item,
    index,
    score: scoreTextAgainstProfile(item, profile),
  }));

  const prioritized = scored
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.item);

  return dedupeTexts([
    ...prioritized,
    ...normalized,
  ]).slice(0, max);
}

function buildSessionIntentProfile(session = null) {
  const taskCard = normalizeSessionTaskCard(session?.taskCard || {}) || {};
  const summary = buildSessionContextSummary(session);
  return buildIntentProfile([
    summary.goal,
    summary.mainGoal,
    summary.checkpoint,
    summary.summary,
    ...summary.nextSteps,
    ...summary.knownConclusions,
    ...takeContextSeedList(taskCard, 'background', 1),
    ...takeContextSeedList(taskCard, 'rawMaterials', 1),
  ]);
}

function buildFocusSection(sourceSession = null, targetSession = null, max = 2) {
  const sourceContext = buildSessionContextSummary(sourceSession, '源任务');
  const targetContext = buildSessionContextSummary(targetSession, '目标任务');
  return dedupeTexts([
    sourceContext.goal ? `源任务目标：${sourceContext.goal}` : '',
    sourceContext.checkpoint ? `源任务检查点：${sourceContext.checkpoint}` : '',
    targetContext.goal ? `目标任务目标：${targetContext.goal}` : '',
    targetContext.checkpoint ? `目标任务接入点：${targetContext.checkpoint}` : '',
  ]).slice(0, max);
}

function buildIntegrationSection({
  sourceSession = null,
  targetSession = null,
  sections = null,
  max = 2,
} = {}) {
  const targetContext = buildSessionContextSummary(targetSession, '目标任务');
  const targetTitle = targetContext.title || '目标任务';
  const targetAnchor = normalizeNullableText(
    targetContext.checkpoint
    || targetContext.nextSteps[0]
    || targetContext.goal
    || targetContext.mainGoal
  );
  const leadConclusion = normalizeNullableText((sections?.conclusions || [])[0]);
  const leadBackground = normalizeNullableText((sections?.background || [])[0]);
  const leadNextStep = normalizeNullableText((sections?.nextSteps || [])[0]);
  const sourceTitle = buildSessionContextSummary(sourceSession, '源任务').title || '源任务';

  return dedupeTexts([
    leadConclusion && targetAnchor
      ? `围绕「${targetAnchor}」优先吸收：${leadConclusion}`
      : '',
    !leadConclusion && leadBackground && targetAnchor
      ? `围绕「${targetAnchor}」优先参考：${leadBackground}`
      : '',
    leadNextStep
      ? `可并入「${targetTitle}」的下一步：${leadNextStep}`
      : '',
    !leadNextStep && targetAnchor && sourceTitle
      ? `将来自「${sourceTitle}」的上下文接入「${targetAnchor}」后继续推进`
      : '',
  ]).slice(0, max);
}

function buildPacketSections(sourceSession = null, targetSession = null, options = {}) {
  const sourceTaskCard = normalizeSessionTaskCard(sourceSession?.taskCard || {}) || {};
  const sourceTitle = getSessionDisplayName(sourceSession, '源任务');
  const detailLevel = resolveHandoffDetailLevel(options?.detailLevel);
  const limits = getHandoffDetailLimits(detailLevel);
  const targetProfile = buildSessionIntentProfile(targetSession);
  const fallbackProfile = buildSessionIntentProfile(sourceSession);
  const activeProfile = targetProfile.size > 0 ? targetProfile : fallbackProfile;

  const background = prioritizeTexts([
    ...takeTaskCardList(sourceTaskCard, 'background', 2),
    ...takeTaskCardList(sourceTaskCard, 'rawMaterials', 2),
  ], activeProfile, limits.background);

  const constraints = prioritizeTexts(
    takeTaskCardList(sourceTaskCard, 'assumptions', 4),
    activeProfile,
    limits.constraints,
  );

  const conclusions = prioritizeTexts([
    ...takeTaskCardList(sourceTaskCard, 'knownConclusions', 3),
    buildFallbackConclusion(sourceTaskCard, sourceTitle)
      ? `阶段摘要：${buildFallbackConclusion(sourceTaskCard, sourceTitle)}`
      : '',
  ], activeProfile, limits.conclusions);

  const nextSteps = prioritizeTexts(
    takeTaskCardList(sourceTaskCard, 'nextSteps', 4),
    activeProfile,
    limits.nextSteps,
  );

  const focus = buildFocusSection(sourceSession, targetSession, limits.focus);
  const sections = {
    focus,
    background,
    constraints,
    conclusions,
    nextSteps,
    integration: [],
  };
  sections.integration = buildIntegrationSection({
    sourceSession,
    targetSession,
    sections,
    max: limits.integration,
  });

  if (
    focus.length === 0
    && background.length === 0
    && constraints.length === 0
    && conclusions.length === 0
    && nextSteps.length === 0
  ) {
    return {
      focus: buildFocusSection(sourceSession, targetSession, limits.focus),
      background: [],
      constraints: [],
      conclusions: [`来自任务「${sourceTitle}」的阶段数据交接`],
      nextSteps: [],
      integration: [],
    };
  }

  return sections;
}

export function buildTaskDataHandoffPacket({
  sourceSession = null,
  targetSession = null,
  detailLevel = 'balanced',
} = {}) {
  const createdAt = nowIso();
  const sourceTitle = getSessionDisplayName(sourceSession, '源任务');
  const targetTitle = getSessionDisplayName(targetSession, '目标任务');
  const resolvedDetailLevel = resolveHandoffDetailLevel(detailLevel);
  const sections = buildPacketSections(sourceSession, targetSession, {
    detailLevel: resolvedDetailLevel,
  });

  return {
    packetId: createWorkbenchId('handoff'),
    createdAt,
    detailLevel: resolvedDetailLevel,
    sourceSessionId: normalizeNullableText(sourceSession?.id),
    targetSessionId: normalizeNullableText(targetSession?.id),
    sourceTitle,
    targetTitle,
    summary: `${sourceTitle} -> ${targetTitle}`,
    sourceContext: buildSessionContextSummary(sourceSession, '源任务'),
    targetContext: buildSessionContextSummary(targetSession, '目标任务'),
    sections,
  };
}

function applyTaskDataHandoffToTaskCard(targetTaskCard = null, packet = null) {
  const current = normalizeSessionTaskCard(targetTaskCard || {}) || {};
  const sections = packet?.sections && typeof packet.sections === 'object' ? packet.sections : {};
  const sourceTitle = normalizeNullableText(packet?.sourceTitle) || '源任务';
  const handoffLine = `来自任务「${sourceTitle}」的数据交接`;
  const focus = Array.isArray(sections.focus) ? sections.focus : [];
  const integration = Array.isArray(sections.integration) ? sections.integration : [];

  return normalizeSessionTaskCard({
    ...current,
    checkpoint: normalizeNullableText(
      current.checkpoint
      || integration[0]
      || (Array.isArray(sections.nextSteps) ? sections.nextSteps[0] : '')
      || (Array.isArray(sections.conclusions) ? sections.conclusions[0] : '')
      || focus[0]
      || handoffLine,
    ),
    background: dedupeTexts([
      handoffLine,
      ...focus,
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
      ...integration,
      ...(current.knownConclusions || []),
    ]),
    nextSteps: dedupeTexts([
      ...integration,
      ...(Array.isArray(sections.nextSteps) ? sections.nextSteps : []),
      ...(current.nextSteps || []),
    ]),
    memory: dedupeTexts([
      `已接收来自「${sourceTitle}」的数据交接`,
      packet?.detailLevel ? `交接细节：${packet.detailLevel}` : '',
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
    detailLevel: payload?.detailLevel,
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
