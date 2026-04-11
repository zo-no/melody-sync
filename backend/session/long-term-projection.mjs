import {
  DEFAULT_SESSION_NAME,
  normalizeSessionDescription,
  normalizeSessionGroup,
  normalizeSessionName,
} from './naming.mjs';
import {
  getLongTermTaskPoolMembership,
  isLongTermProjectSession,
} from './task-pool-membership.mjs';

const GENERIC_GROUP_KEYS = new Set(['inbox', '收集箱']);
const GENERIC_TITLE_KEYS = new Set([
  DEFAULT_SESSION_NAME,
  'initial task',
  'new task',
  '初始化任务',
]);
const STOPWORD_KEYS = new Set([
  'a',
  'an',
  'and',
  'chat',
  'current',
  'flow',
  'goal',
  'main',
  'map',
  'maps',
  'new',
  'session',
  'sessions',
  'task',
  'tasks',
  'the',
  'this',
  'work',
  'workflow',
  '任务',
  '会话',
  '地图',
  '工作',
  '当前',
  '继续',
]);
const MAX_SUMMARY_CHARS = 120;
const MAX_TITLE_CHARS = 88;
const MIN_LONG_TERM_SUGGESTION_SCORE = 6;
const CLEAR_LONG_TERM_SUGGESTION_SCORE = 8;

function trimText(value) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
}

function clipText(value, maxChars) {
  const text = trimText(value);
  if (!text || !Number.isInteger(maxChars) || maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  if (maxChars === 1) return '…';
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function normalizeComparableText(value) {
  return trimText(value)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s\u4e00-\u9fff]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCjkBigrams(value) {
  const bigrams = new Set();
  const segments = String(value || '').match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const segment of segments) {
    for (let index = 0; index < segment.length - 1; index += 1) {
      bigrams.add(segment.slice(index, index + 2));
      if (bigrams.size >= 48) return [...bigrams];
    }
  }
  return [...bigrams];
}

function collectComparableTokens(value) {
  const normalized = normalizeComparableText(value);
  if (!normalized) return new Set();
  const tokens = new Set(
    (normalized.match(/[a-z0-9]{3,}/g) || [])
      .map((entry) => entry.trim())
      .filter((entry) => entry && !STOPWORD_KEYS.has(entry)),
  );
  for (const token of buildCjkBigrams(normalized)) {
    if (!STOPWORD_KEYS.has(token)) {
      tokens.add(token);
    }
    if (tokens.size >= 64) break;
  }
  return tokens;
}

function normalizePersistentKind(value) {
  const normalized = normalizeComparableText(value).replace(/\s+/g, '_');
  if (normalized === 'recurring_task') return 'recurring_task';
  if (normalized === 'scheduled_task') return 'scheduled_task';
  if (normalized === 'waiting_task') return 'waiting_task';
  if (normalized === 'skill') return 'skill';
  return '';
}

function getSessionParentSessionId(session = null) {
  return trimText(session?.sourceContext?.parentSessionId || '');
}

function getSessionRootSessionId(session = null) {
  return trimText(session?.rootSessionId || session?.id || '');
}

function isStandaloneRootSession(session = null) {
  const sessionId = trimText(session?.id || '');
  if (!sessionId || getSessionParentSessionId(session)) return false;
  return getSessionRootSessionId(session) === sessionId;
}

function getSessionStateSeed(session = null) {
  const taskCard = session?.taskCard && typeof session.taskCard === 'object' ? session.taskCard : {};
  const state = session?.sessionState && typeof session.sessionState === 'object' ? session.sessionState : {};
  return {
    goal: trimText(state.goal || taskCard.goal),
    mainGoal: trimText(state.mainGoal || taskCard.mainGoal || taskCard.branchFrom),
    checkpoint: trimText(state.checkpoint || taskCard.checkpoint || taskCard.summary),
  };
}

function getSessionTitle(session = null) {
  const state = getSessionStateSeed(session);
  return clipText(
    state.mainGoal
      || state.goal
      || normalizeSessionName(session?.name || ''),
    MAX_TITLE_CHARS,
  );
}

function getSessionSummary(session = null) {
  const taskCard = session?.taskCard && typeof session.taskCard === 'object' ? session.taskCard : {};
  const state = getSessionStateSeed(session);
  return clipText(
    normalizeSessionDescription(session?.description || '')
      || trimText(taskCard.checkpoint || '')
      || trimText(taskCard.summary || '')
      || trimText(state.checkpoint || ''),
    MAX_SUMMARY_CHARS,
  );
}

function getSessionGroup(session = null) {
  return normalizeSessionGroup(session?.group || '');
}

function isGenericGroup(group) {
  return GENERIC_GROUP_KEYS.has(normalizeComparableText(group));
}

function isMeaningfulRootSession(session = null) {
  if (!isStandaloneRootSession(session) || session?.archived === true) return false;
  const title = getSessionTitle(session);
  const normalizedTitle = normalizeComparableText(title);
  if (!normalizedTitle || GENERIC_TITLE_KEYS.has(normalizedTitle)) {
    return false;
  }
  if (session?.autoRenamePending === true && normalizedTitle === DEFAULT_SESSION_NAME) {
    return false;
  }
  return true;
}

function getCandidateComparableText(session = null) {
  const state = getSessionStateSeed(session);
  return [
    getSessionTitle(session),
    state.goal,
    state.mainGoal,
    getSessionSummary(session),
    getSessionGroup(session),
    normalizeSessionDescription(session?.description || ''),
  ].filter(Boolean).join(' ');
}

function scoreLongTermCandidate(candidate, {
  currentSession = null,
  turnText = '',
} = {}) {
  const currentState = getSessionStateSeed(currentSession);
  const currentTitle = getSessionTitle(currentSession);
  const currentGroup = getSessionGroup(currentSession);
  const currentComparable = [
    trimText(turnText),
    currentTitle,
    currentState.goal,
    currentState.mainGoal,
    normalizeSessionDescription(currentSession?.description || ''),
    currentGroup,
  ].filter(Boolean).join(' ');
  const normalizedCurrentComparable = normalizeComparableText(currentComparable);
  const candidateTitle = getSessionTitle(candidate);
  const normalizedCandidateTitle = normalizeComparableText(candidateTitle);
  const candidateSummary = getSessionSummary(candidate);
  const candidateGroup = getSessionGroup(candidate);

  let score = 0;

  if (normalizedCurrentComparable && normalizedCandidateTitle) {
    if (
      normalizedCurrentComparable.includes(normalizedCandidateTitle)
      || normalizedCandidateTitle.includes(normalizedCurrentComparable)
    ) {
      score += 8;
    }
  }

  if (
    currentGroup
    && candidateGroup
    && !isGenericGroup(currentGroup)
    && normalizeComparableText(currentGroup) === normalizeComparableText(candidateGroup)
  ) {
    score += 4;
  }

  const currentFolder = trimText(currentSession?.folder || '');
  const candidateFolder = trimText(candidate?.folder || '');
  if (currentFolder && candidateFolder && currentFolder === candidateFolder && currentFolder !== '~') {
    score += 3;
  }

  if (normalizedCurrentComparable && candidateSummary) {
    const normalizedSummary = normalizeComparableText(candidateSummary);
    if (
      normalizedSummary
      && (
        normalizedCurrentComparable.includes(normalizedSummary)
        || normalizedSummary.includes(normalizedCurrentComparable)
      )
    ) {
      score += 2;
    }
  }

  const currentTokens = collectComparableTokens(currentComparable);
  const candidateTokens = collectComparableTokens(getCandidateComparableText(candidate));
  let overlapCount = 0;
  for (const token of currentTokens) {
    if (!candidateTokens.has(token)) continue;
    overlapCount += 1;
    if (overlapCount >= 6) break;
  }
  score += overlapCount;

  return score;
}

function normalizeLongTermSuggestion(value = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rootSessionId = trimText(value.rootSessionId || value.projectSessionId || '');
  if (!rootSessionId) return null;
  const title = trimText(value.title || value.rootTitle || '');
  const summary = trimText(value.summary || value.rootSummary || '');
  const score = Number.isFinite(Number(value.score)) ? Number(value.score) : 0;
  return {
    rootSessionId,
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    ...(score > 0 ? { score } : {}),
  };
}

function normalizeLongTermBucket(value = '') {
  const normalized = trimText(value || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'inbox') return 'inbox';
  if (['short_term_iteration', 'short_term', '短期任务'].includes(normalized)) return 'short_term';
  if (['long_term_iteration', 'long_term', '长期任务'].includes(normalized)) return 'long_term';
  if (['waiting', 'waiting_for', 'waiting_user', '等待任务', '等待'].includes(normalized)) return 'waiting';
  return '';
}

export function normalizeLongTermSessionProjection(value = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const lane = trimText(value.lane || '').toLowerCase() === 'long-term' ? 'long-term' : 'sessions';
  const role = ['project', 'member'].includes(trimText(value.role || '').toLowerCase())
    ? trimText(value.role || '').toLowerCase()
    : '';
  const rootSessionId = trimText(value.rootSessionId || value.projectSessionId || '');
  const rootTitle = trimText(value.rootTitle || '');
  const rootSummary = trimText(value.rootSummary || '');
  const bucket = normalizeLongTermBucket(value.bucket || value.bucketId || '');
  const suggestion = normalizeLongTermSuggestion(value.suggestion);

  if (!rootSessionId && !suggestion) return null;

  return {
    lane,
    ...(role ? { role } : {}),
    ...(rootSessionId ? { rootSessionId } : {}),
    ...(rootTitle ? { rootTitle } : {}),
    ...(rootSummary ? { rootSummary } : {}),
    ...(bucket ? { bucket } : {}),
    ...(suggestion ? { suggestion } : {}),
  };
}

function buildCurrentComparableState(currentSession = null, turnText = '') {
  const currentState = getSessionStateSeed(currentSession);
  const currentTitle = getSessionTitle(currentSession);
  const currentGroup = getSessionGroup(currentSession);
  const currentComparable = [
    trimText(turnText),
    currentTitle,
    currentState.goal,
    currentState.mainGoal,
    normalizeSessionDescription(currentSession?.description || ''),
    currentGroup,
  ].filter(Boolean).join(' ');
  return {
    currentGroup,
    currentFolder: trimText(currentSession?.folder || ''),
    normalizedCurrentComparable: normalizeComparableText(currentComparable),
    currentTokens: collectComparableTokens(currentComparable),
  };
}

function scorePreparedLongTermCandidate(candidateRecord = null, currentComparableState = null) {
  if (!candidateRecord || !currentComparableState) return 0;
  const normalizedCurrentComparable = currentComparableState.normalizedCurrentComparable || '';
  let score = 0;

  if (normalizedCurrentComparable && candidateRecord.normalizedTitle) {
    if (
      normalizedCurrentComparable.includes(candidateRecord.normalizedTitle)
      || candidateRecord.normalizedTitle.includes(normalizedCurrentComparable)
    ) {
      score += 8;
    }
  }

  if (
    currentComparableState.currentGroup
    && candidateRecord.group
    && !isGenericGroup(currentComparableState.currentGroup)
    && normalizeComparableText(currentComparableState.currentGroup) === normalizeComparableText(candidateRecord.group)
  ) {
    score += 4;
  }

  if (
    currentComparableState.currentFolder
    && candidateRecord.folder
    && currentComparableState.currentFolder === candidateRecord.folder
    && currentComparableState.currentFolder !== '~'
  ) {
    score += 3;
  }

  if (normalizedCurrentComparable && candidateRecord.normalizedSummary) {
    if (
      normalizedCurrentComparable.includes(candidateRecord.normalizedSummary)
      || candidateRecord.normalizedSummary.includes(normalizedCurrentComparable)
    ) {
      score += 2;
    }
  }

  let overlapCount = 0;
  for (const token of currentComparableState.currentTokens || []) {
    if (!candidateRecord.tokens.has(token)) continue;
    overlapCount += 1;
    if (overlapCount >= 6) break;
  }
  score += overlapCount;

  return score;
}

function prepareLongTermCandidateRecord(candidate = null, index = 0) {
  const title = getSessionTitle(candidate);
  const summary = getSessionSummary(candidate);
  const group = getSessionGroup(candidate);
  const folder = trimText(candidate?.folder || '');
  const comparableText = getCandidateComparableText(candidate);
  return {
    candidate,
    index,
    title,
    normalizedTitle: normalizeComparableText(title),
    summary,
    normalizedSummary: normalizeComparableText(summary),
    group,
    folder,
    tokens: collectComparableTokens(comparableText),
    updatedAt: Date.parse(candidate?.updatedAt || candidate?.lastEventAt || candidate?.created || '') || 0,
  };
}

export function createLongTermProjectionContext(sessions = []) {
  const allSessions = Array.isArray(sessions) ? sessions : [];
  const sessionById = new Map(
    allSessions
      .filter((session) => trimText(session?.id || ''))
      .map((session) => [trimText(session.id), session]),
  );
  const getSessionById = (sessionId = '') => {
    const normalizedSessionId = trimText(sessionId);
    if (!normalizedSessionId) return null;
    return sessionById.get(normalizedSessionId) || null;
  };
  const candidateRoots = allSessions
    .filter((session) => isMeaningfulRootSession(session))
    .filter((session) => isLongTermProjectSession(session, { getSessionById }))
    .map((candidate, index) => prepareLongTermCandidateRecord(candidate, index));
  return {
    sessions: allSessions,
    sessionById,
    candidateRoots,
  };
}

function resolveProjectionContext(sessionsOrContext = []) {
  if (
    sessionsOrContext
    && typeof sessionsOrContext === 'object'
    && !Array.isArray(sessionsOrContext)
    && sessionsOrContext.sessionById instanceof Map
    && Array.isArray(sessionsOrContext.candidateRoots)
  ) {
    return sessionsOrContext;
  }
  return createLongTermProjectionContext(sessionsOrContext);
}

export function rankLongTermProjectCandidates(currentSession = null, sessionsOrContext = [], { turnText = '' } = {}) {
  const context = resolveProjectionContext(sessionsOrContext);
  const currentSessionId = trimText(currentSession?.id || '');
  const currentComparableState = buildCurrentComparableState(currentSession, turnText);

  return context.candidateRoots
    .filter((entry) => trimText(entry?.candidate?.id || '') !== currentSessionId)
    .map((entry) => ({
      candidate: entry.candidate,
      index: entry.index,
      score: scorePreparedLongTermCandidate(entry, currentComparableState),
      updatedAt: entry.updatedAt,
    }))
    .sort((left, right) => (
      (right.score - left.score)
      || (right.updatedAt - left.updatedAt)
      || (left.index - right.index)
    ));
}

function pickSuggestedLongTermCandidate(currentSession = null, sessionsOrContext = [], options = {}) {
  const ranked = rankLongTermProjectCandidates(currentSession, sessionsOrContext, options);
  const best = ranked[0] || null;
  const second = ranked[1] || null;
  if (!best || best.score < MIN_LONG_TERM_SUGGESTION_SCORE) {
    return null;
  }
  if (
    second
    && best.score < CLEAR_LONG_TERM_SUGGESTION_SCORE
    && (best.score - second.score) < 2
  ) {
    return null;
  }
  return best.candidate;
}

export function buildLongTermSessionProjection(session = null, sessionsOrContext = [], { turnText = '' } = {}) {
  const sessionId = trimText(session?.id || '');
  if (!sessionId) return null;

  const context = resolveProjectionContext(sessionsOrContext);
  const getSessionById = (candidateId = '') => {
    const normalizedCandidateId = trimText(candidateId);
    if (!normalizedCandidateId) return null;
    if (normalizedCandidateId === sessionId) return session;
    return context.sessionById.get(normalizedCandidateId) || null;
  };

  const membership = getLongTermTaskPoolMembership(session, { getSessionById });
  if (membership?.projectSessionId) {
    const rootSession = getSessionById(membership.projectSessionId);
    return normalizeLongTermSessionProjection({
      lane: 'long-term',
      role: membership.role || (membership.projectSessionId === sessionId ? 'project' : 'member'),
      rootSessionId: membership.projectSessionId,
      rootTitle: getSessionTitle(rootSession),
      rootSummary: getSessionSummary(rootSession),
      bucket: membership.bucket || '',
    });
  }

  if (
    session?.archived === true
    || !isStandaloneRootSession(session)
    || normalizePersistentKind(session?.persistent?.kind) !== ''
  ) {
    return null;
  }

  const suggestion = pickSuggestedLongTermCandidate(session, context, { turnText });
  if (!suggestion) return null;

  return normalizeLongTermSessionProjection({
    lane: 'sessions',
    suggestion: {
      rootSessionId: trimText(suggestion?.id || ''),
      title: getSessionTitle(suggestion),
      summary: getSessionSummary(suggestion),
      score: scorePreparedLongTermCandidate(
        prepareLongTermCandidateRecord(suggestion, 0),
        buildCurrentComparableState(session, turnText),
      ),
    },
  });
}
