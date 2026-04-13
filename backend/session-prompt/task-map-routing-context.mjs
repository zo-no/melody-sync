import {
  DEFAULT_SESSION_NAME,
  normalizeSessionDescription,
  normalizeSessionGroup,
  normalizeSessionName,
} from '../session/naming.mjs';
import { rankLongTermProjectCandidates } from '../session/long-term-projection.mjs';
import { resolveSessionStateFromSession } from '../session-runtime/session-state.mjs';
import { isLongTermProjectSession as isTaskPoolLongTermProjectSession } from '../session/task-pool-membership.mjs';

const MAX_CANDIDATE_MAPS = 6;
const MAX_CONTEXT_CHARS = 1800;
const MAX_LINE_CHARS = 240;
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

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clipText(value, maxChars) {
  const text = normalizeText(value);
  if (!text || !Number.isInteger(maxChars) || maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  if (maxChars === 1) return '…';
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function normalizeComparableText(value) {
  return normalizeText(value)
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

function getSessionParentSessionId(session = null) {
  return normalizeText(session?.sourceContext?.parentSessionId || '');
}

function getSessionRootSessionId(session = null) {
  return normalizeText(session?.rootSessionId || session?.id || '');
}

function isRootSession(session = null) {
  const sessionId = normalizeText(session?.id || '');
  if (!sessionId || getSessionParentSessionId(session)) return false;
  return getSessionRootSessionId(session) === sessionId;
}

function getSessionState(session = null) {
  return resolveSessionStateFromSession(session || {});
}

function getSessionTitle(session = null) {
  const state = getSessionState(session);
  return clipText(
    state.mainGoal
      || state.goal
      || normalizeSessionName(session?.name || ''),
    88,
  );
}

function getSessionSummary(session = null) {
  const taskCard = session?.taskCard && typeof session.taskCard === 'object' ? session.taskCard : {};
  const state = getSessionState(session);
  return clipText(
    normalizeSessionDescription(session?.description || '')
      || normalizeText(taskCard.checkpoint || '')
      || normalizeText(taskCard.summary || '')
      || normalizeText(state.checkpoint || ''),
    120,
  );
}

function getSessionGroup(session = null) {
  return normalizeSessionGroup(session?.group || '');
}


function isGenericGroup(group) {
  return GENERIC_GROUP_KEYS.has(normalizeComparableText(group));
}

function isMeaningfulRootSession(session = null) {
  if (!isRootSession(session) || session?.archived === true) return false;
  const wf = String(session?.workflowState || '').trim().toLowerCase();
  if (wf === 'done' || wf === 'complete' || wf === 'completed') return false;
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

function isLongTermProjectRootSession(session = null) {
  return isMeaningfulRootSession(session) && isTaskPoolLongTermProjectSession(session);
}

function getCandidateComparableText(session = null) {
  const state = getSessionState(session);
  return [
    getSessionTitle(session),
    state.goal,
    state.mainGoal,
    getSessionSummary(session),
    getSessionGroup(session),
    normalizeSessionDescription(session?.description || ''),
  ].filter(Boolean).join(' ');
}

function scoreCandidateMap(candidate, {
  currentSession = null,
  turnText = '',
} = {}) {
  const currentState = getSessionState(currentSession);
  const currentTitle = getSessionTitle(currentSession);
  const currentGroup = getSessionGroup(currentSession);
  const currentComparable = [
    normalizeText(turnText),
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

  const currentFolder = normalizeText(currentSession?.folder || '');
  const candidateFolder = normalizeText(candidate?.folder || '');
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

function getCandidateUpdatedAt(session = null) {
  return Date.parse(session?.updatedAt || session?.lastEventAt || session?.created || '') || 0;
}

function countSessionsInMap(sessions = [], rootSessionId = '') {
  const normalizedRootSessionId = normalizeText(rootSessionId);
  if (!normalizedRootSessionId) return 0;
  return (Array.isArray(sessions) ? sessions : []).filter((session) => {
    if (!session?.id || session.archived === true) return false;
    const wf = String(session?.workflowState || '').trim().toLowerCase();
    if (wf === 'done' || wf === 'complete' || wf === 'completed') return false;
    return getSessionRootSessionId(session) === normalizedRootSessionId;
  }).length;
}

function formatCandidateMapLine(candidate, sessions = []) {
  const sessionId = normalizeText(candidate?.id || '');
  const title = getSessionTitle(candidate);
  const summary = getSessionSummary(candidate);
  const group = getSessionGroup(candidate);
  const mapSize = countSessionsInMap(sessions, sessionId);
  const childCount = Math.max(0, mapSize - 1);
  const parts = [`${title} (sessionId: ${sessionId})`];
  if (group && !isGenericGroup(group)) {
    parts.push(`group: ${group}`);
  }
  if (childCount > 0) {
    parts.push(`children: ${childCount}`);
  }
  if (summary) {
    parts.push(summary);
  }
  return clipText(`- ${parts.join(' - ')}`, MAX_LINE_CHARS);
}

export function buildTaskMapRoutingPromptContext({
  currentSession = null,
  sessions = [],
  turnText = '',
} = {}) {
  if (!currentSession?.id || getSessionParentSessionId(currentSession)) {
    return '';
  }

  const allCandidateRoots = (Array.isArray(sessions) ? sessions : [])
    .filter((session) => session?.id && session.id !== currentSession.id)
    .filter((session) => isMeaningfulRootSession(session));
  if (allCandidateRoots.length === 0) {
    return '';
  }
  const longTermCandidateRoots = allCandidateRoots.filter((session) => isLongTermProjectRootSession(session));
  const candidateRoots = longTermCandidateRoots.length > 0 ? longTermCandidateRoots : allCandidateRoots;
  const longTermOnly = longTermCandidateRoots.length > 0;

  const rankedCandidates = longTermOnly
    ? rankLongTermProjectCandidates(currentSession, candidateRoots, { turnText }).slice(0, MAX_CANDIDATE_MAPS)
    : candidateRoots
      .map((candidate, index) => ({
        candidate,
        index,
        score: scoreCandidateMap(candidate, { currentSession, turnText }),
        updatedAt: getCandidateUpdatedAt(candidate),
      }))
      .sort((left, right) => (
        (right.score - left.score)
        || (right.updatedAt - left.updatedAt)
        || (left.index - right.index)
      ))
      .slice(0, MAX_CANDIDATE_MAPS);

  if (rankedCandidates.length === 0) {
    return '';
  }

  const lines = [
    'This is the first real user turn for a standalone session.',
    longTermOnly
      ? 'If the current task clearly belongs under one existing long-term task map, you may propose one hidden graph_ops attach suggestion from `current` to that root map.'
      : 'If the current task clearly belongs under one existing main task map, you may propose one hidden graph_ops attach suggestion from `current` to that root map.',
    'If the fit is weak or ambiguous, keep the current session as its own main map.',
    longTermOnly
      ? 'Only consider root/main task maps from the long-term list below. Do not target child sessions.'
      : 'Only consider root/main task maps from the list below. Do not target child sessions.',
    '',
    longTermOnly ? 'Candidate long-term task maps:' : 'Candidate main task maps:',
  ];

  for (const entry of rankedCandidates) {
    const line = formatCandidateMapLine(entry.candidate, sessions);
    if (!line) continue;
    const nextText = `${lines.join('\n')}\n${line}`;
    if (nextText.length > MAX_CONTEXT_CHARS) break;
    lines.push(line);
  }

  if (
    lines[lines.length - 1] === 'Candidate main task maps:'
    || lines[lines.length - 1] === 'Candidate long-term task maps:'
  ) {
    return '';
  }

  return lines.join('\n');
}
