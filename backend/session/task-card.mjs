const TASK_CARD_TAG = 'task_card';
const TASK_CARD_KEYS = new Set([
  'mode',
  'summary',
  'goal',
  'mainGoal',
  'lineRole',
  'branchFrom',
  'branchReason',
  'checkpoint',
  'candidateBranches',
  'background',
  'rawMaterials',
  'assumptions',
  'knownConclusions',
  'nextSteps',
  'memory',
  'needsFromUser',
]);

function resolveTaskCardLimit(value, fallback) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

const MAX_TASK_CARD_TEXT_CHARS = resolveTaskCardLimit(process.env.MELODYSYNC_TASK_CARD_TEXT_CHARS, 2400);
const MAX_TASK_CARD_GOAL_CHARS = resolveTaskCardLimit(process.env.MELODYSYNC_TASK_CARD_GOAL_CHARS, MAX_TASK_CARD_TEXT_CHARS);
const MAX_TASK_CARD_ITEM_CHARS = resolveTaskCardLimit(process.env.MELODYSYNC_TASK_CARD_ITEM_CHARS, 420);
const MAX_TASK_CARD_ITEMS = resolveTaskCardLimit(process.env.MELODYSYNC_TASK_CARD_ITEMS, 16);
const MAX_TASK_CARD_NEXT_STEP_ITEMS = resolveTaskCardLimit(process.env.MELODYSYNC_TASK_CARD_NEXT_STEP_ITEMS, 12);
const MAX_TASK_CARD_CANDIDATE_BRANCH_ITEMS = resolveTaskCardLimit(process.env.MELODYSYNC_TASK_CARD_CANDIDATE_BRANCH_ITEMS, 3);
const MAX_TASK_CARD_CANDIDATE_BRANCH_CHARS = resolveTaskCardLimit(process.env.MELODYSYNC_TASK_CARD_CANDIDATE_BRANCH_CHARS, 220);

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

function normalizeTaskCardMode(value) {
  if (value === true) return 'project';
  if (value === false) return 'task';
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (['project', 'project_mode', 'project-mode', 'projectmode'].includes(normalized)) {
    return 'project';
  }
  if (['task', 'single_task', 'single-task', 'session'].includes(normalized)) {
    return 'task';
  }
  return '';
}

function normalizeTaskCardLineRole(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['branch', 'side', 'branching', 'branch-line'].includes(normalized)) {
    return 'branch';
  }
  return 'main';
}

function normalizeIntentText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\r\n/g, '\n')
    .replace(/[^\p{Letter}\p{Number}\n\s\u4e00-\u9fff]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textLooksEquivalent(left, right) {
  const leftText = normalizeIntentText(left);
  const rightText = normalizeIntentText(right);
  if (!leftText || !rightText) return false;
  return leftText === rightText || leftText.includes(rightText) || rightText.includes(leftText);
}

const INTENT_SHIFT_REASON_PATTERN = /(?:另外|另一|单独|独立|并行|专题|另开|拆出|拆开|分支|支线|切换|转到|转而|换成|不再|脱离|偏离|不同对象|不同目标|不同交付|上下文污染|污染主线|避免污染|separate|independent|parallel|split|branch|switch|drift)/i;
const SAME_GOAL_REASON_PATTERN = /(?:继续|补充|细化|展开|延伸|说明|约束|调整|修改|优化|完善|补画|重画|再画|再来|追问|示意|草图|变体|同一目标|同一任务|同一条线)/i;
const NON_INDEPENDENT_TITLE_PATTERN = /^(?:继续|补充|细化|完善|优化|调整|补画|重画|再画|再来|解释|说明|举例|排序|润色)/i;

function taskCardIndicatesIntentShiftNormalized(normalized, branchTitle) {
  const title = normalizeIntentText(branchTitle);
  if (!normalized || !title) return false;

  if (
    textLooksEquivalent(title, normalized.goal)
    || textLooksEquivalent(title, normalized.mainGoal)
    || (normalized.knownConclusions || []).some((entry) => textLooksEquivalent(title, entry))
    || textLooksEquivalent(title, normalized.checkpoint)
  ) {
    return false;
  }

  const reason = normalizeIntentText(normalized.branchReason);
  if (!reason) return false;
  if (SAME_GOAL_REASON_PATTERN.test(reason) && !INTENT_SHIFT_REASON_PATTERN.test(reason)) {
    return false;
  }
  return INTENT_SHIFT_REASON_PATTERN.test(reason);
}

function taskCardHasIndependentBranchGoalNormalized(normalized, branchTitle) {
  const title = normalizeIntentText(branchTitle);
  if (!normalized || !title) return false;
  if (NON_INDEPENDENT_TITLE_PATTERN.test(title)) return false;

  if (
    textLooksEquivalent(title, normalized.goal)
    || textLooksEquivalent(title, normalized.mainGoal)
    || (normalized.knownConclusions || []).some((entry) => textLooksEquivalent(title, entry))
    || textLooksEquivalent(title, normalized.checkpoint)
  ) {
    return false;
  }

  return title.length >= 2;
}

function taskCardSupportsAutoBranchNormalized(normalized, branchTitle) {
  if (!normalized) return false;
  if (!taskCardHasIndependentBranchGoalNormalized(normalized, branchTitle)) return false;
  const reason = normalizeIntentText(normalized.branchReason);
  if (!reason) return true;
  if (SAME_GOAL_REASON_PATTERN.test(reason) && !INTENT_SHIFT_REASON_PATTERN.test(reason)) {
    return false;
  }
  return true;
}

function filterCandidateBranches(normalized, candidates = []) {
  if (!normalized || !Array.isArray(candidates) || candidates.length === 0) return [];
  const accepted = [];
  const seen = new Set();
  for (const branchTitle of candidates) {
    if (!taskCardSupportsAutoBranchNormalized(normalized, branchTitle)) continue;
    const key = normalizeIntentText(branchTitle);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    accepted.push(branchTitle);
    if (accepted.length >= 3) break;
  }
  return accepted;
}

function normalizeTaskCardList(value, options = {}) {
  const maxItems = Number.isInteger(options.maxItems) && options.maxItems > 0
    ? options.maxItems
    : MAX_TASK_CARD_ITEMS;
  const maxChars = Number.isInteger(options.maxChars) && options.maxChars > 0
    ? options.maxChars
    : MAX_TASK_CARD_ITEM_CHARS;
  const rawItems = Array.isArray(value)
    ? value
    : (typeof value === 'string' && value.trim()
      ? value.split(/\n+/)
      : []);
  const items = [];
  const seen = new Set();
  for (const raw of rawItems) {
    const normalized = clipText(String(raw || '').replace(/^[-*•]\s*/, ''), maxChars);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(normalized);
    if (items.length >= maxItems) break;
  }
  return items;
}

function extractTaggedBlock(content, tagName) {
  const text = typeof content === 'string' ? content : '';
  if (!text || !tagName) return '';
  const match = text.match(new RegExp(`<${tagName}>([\\s\\S]*?)<(?:\\\\/|/)${tagName}>`, 'i'));
  return (match ? match[1] : '').trim();
}

function parseJsonObjectText(modelText) {
  const text = typeof modelText === 'string' ? modelText.trim() : '';
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function looksLikeTaskCardObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).some((key) => TASK_CARD_KEYS.has(String(key || '').trim()));
}

function extractTrailingTaskCardJsonBounds(content) {
  const text = typeof content === 'string' ? content : '';
  const trimmedEnd = text.trimEnd();
  if (!trimmedEnd || !trimmedEnd.endsWith('}')) return null;

  const trailingFenceCount = (value, upto) => {
    const prefix = String(value || '').slice(0, upto);
    return (prefix.match(/```/g) || []).length;
  };
  const insideFencedCodeBlock = (value, index) => (trailingFenceCount(value, index) % 2) === 1;
  const prefixLooksLikeMetadataBoundary = (prefix) => {
    if (!prefix) return true;
    if (/(?:^|\n\s*\n)\s*$/.test(prefix)) return true;
    const trimmedPrefix = prefix.trimEnd();
    if (!trimmedPrefix) return true;
    return /[。！？!?.,，:：;；、…"'”’)\]）】》」』>]+$/.test(trimmedPrefix);
  };

  let startIndex = trimmedEnd.lastIndexOf('{');
  while (startIndex !== -1) {
    if (insideFencedCodeBlock(trimmedEnd, startIndex)) {
      startIndex = trimmedEnd.lastIndexOf('{', startIndex - 1);
      continue;
    }
    const prefix = trimmedEnd.slice(0, startIndex);
    if (prefixLooksLikeMetadataBoundary(prefix)) {
      const candidate = trimmedEnd.slice(startIndex);
      const parsed = parseJsonObjectText(candidate);
      if (looksLikeTaskCardObject(parsed)) {
        return {
          start: startIndex,
          end: trimmedEnd.length,
          parsed,
        };
      }
    }
    startIndex = trimmedEnd.lastIndexOf('{', startIndex - 1);
  }

  return null;
}

function cleanupTaskCardGapText(value) {
  return String(value || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasMeaningfulTaskCard(card) {
  if (!card || typeof card !== 'object') return false;
  return Boolean(
    card.goal
    || card.mainGoal
    || card.summary
    || card.checkpoint
    || (card.background || []).length > 0
    || (card.rawMaterials || []).length > 0
    || (card.assumptions || []).length > 0
    || (card.knownConclusions || []).length > 0
    || (card.nextSteps || []).length > 0
    || (card.candidateBranches || []).length > 0
    || (card.memory || []).length > 0
    || (card.needsFromUser || []).length > 0
  );
}

export function normalizeSessionTaskCard(value, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const goal = clipText(value.goal || value.objective || '', MAX_TASK_CARD_GOAL_CHARS);
  const mainGoal = clipText(value.mainGoal || value.primaryGoal || value.mainlineGoal || '', MAX_TASK_CARD_GOAL_CHARS);
  const summary = clipText(value.summary || value.taskSummary || value.brief || '', MAX_TASK_CARD_TEXT_CHARS);
  const lineRole = normalizeTaskCardLineRole(value.lineRole || value.branchState || value.threadRole);
  const branchFrom = clipText(value.branchFrom || value.parentGoal || value.mainline || '', MAX_TASK_CARD_ITEM_CHARS);
  const branchReason = clipText(value.branchReason || value.driftReason || '', MAX_TASK_CARD_ITEM_CHARS);
  const checkpoint = clipText(value.checkpoint || value.resumePoint || value.returnPoint || value.reentryPoint || '', MAX_TASK_CARD_TEXT_CHARS);
  const candidateBranches = normalizeTaskCardList(
    value.candidateBranches || value.branchCandidates || value.sideQuests || value.sideLines,
    { maxItems: MAX_TASK_CARD_CANDIDATE_BRANCH_ITEMS, maxChars: MAX_TASK_CARD_CANDIDATE_BRANCH_CHARS },
  );
  const background = normalizeTaskCardList(value.background || value.contextBackground || value.backgroundContext);
  const rawMaterials = normalizeTaskCardList(value.rawMaterials || value.materials || value.inputs);
  const assumptions = normalizeTaskCardList(value.assumptions || value.openAssumptions || value.hypotheses);
  const knownConclusions = normalizeTaskCardList(
    value.knownConclusions || value.conclusions || value.knownFindings || value.findings,
    { maxItems: 4 },
  );
  const nextSteps = normalizeTaskCardList(value.nextSteps || value.nextActions || value.actions, {
    maxItems: MAX_TASK_CARD_NEXT_STEP_ITEMS,
  });
  const memory = normalizeTaskCardList(value.memory || value.userMemory || value.reusableContext || value.durableMemory);
  const needsFromUser = normalizeTaskCardList(
    value.needsFromUser || value.userNeeds || value.pendingUserInputs,
    { maxItems: 3 },
  );
  const mode = normalizeTaskCardMode(
    value.mode
    || value.executionMode
    || value.projectState
    || value.projectMode,
  ) || 'task';

  const normalized = {
    version: 1,
    mode,
    summary,
    goal,
    mainGoal: mainGoal || goal,
    lineRole,
    branchFrom: lineRole === 'branch' ? (branchFrom || mainGoal || goal) : '',
    branchReason,
    checkpoint,
    candidateBranches,
    background,
    rawMaterials,
    assumptions,
    knownConclusions,
    nextSteps,
    memory,
    needsFromUser,
  };

  if (options?.preserveCandidateBranches !== true) {
    normalized.candidateBranches = filterCandidateBranches(normalized, normalized.candidateBranches);
  }

  return hasMeaningfulTaskCard(normalized) ? normalized : null;
}

function formatTaskCardList(label, items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return `${label}:\n${items.map((item) => `- ${item}`).join('\n')}`;
}

export function taskCardIndicatesIntentShift(taskCard, branchTitle) {
  return taskCardIndicatesIntentShiftNormalized(normalizeSessionTaskCard(taskCard), branchTitle);
}

export function taskCardHasIndependentBranchGoal(taskCard, branchTitle) {
  return taskCardHasIndependentBranchGoalNormalized(normalizeSessionTaskCard(taskCard), branchTitle);
}

export function shouldSurfaceTaskCardBranchCandidate(taskCard, branchTitle) {
  return taskCardSupportsAutoBranchNormalized(normalizeSessionTaskCard(taskCard), branchTitle);
}

function buildTaskCardStateBlock(normalized, fixedTaskTitle) {
  if (!normalized) return '';
  return [
    'Current carried task card (this tracks the session-level task anchor, not a per-message recap):',
    fixedTaskTitle ? `Fixed session task title: ${fixedTaskTitle}` : '',
    `Execution mode: ${normalized.mode}`,
    normalized.summary ? `Summary: ${normalized.summary}` : '',
    normalized.goal ? `Current goal: ${normalized.goal}` : '',
    normalized.mainGoal ? `Main goal: ${normalized.mainGoal}` : '',
    `Line role: ${normalized.lineRole}`,
    normalized.branchFrom ? `Branch from: ${normalized.branchFrom}` : '',
    normalized.branchReason ? `Branch reason: ${normalized.branchReason}` : '',
    normalized.checkpoint ? `Checkpoint: ${normalized.checkpoint}` : '',
    formatTaskCardList('Candidate branches', normalized.candidateBranches),
    formatTaskCardList('Background', normalized.background),
    formatTaskCardList('Raw materials', normalized.rawMaterials),
    formatTaskCardList('Assumptions', normalized.assumptions),
    formatTaskCardList('Known conclusions', normalized.knownConclusions),
    formatTaskCardList('Next steps', normalized.nextSteps),
    formatTaskCardList('Durable user memory', normalized.memory),
    formatTaskCardList('Needs from user', normalized.needsFromUser),
  ].filter(Boolean).join('\n\n');
}

function buildTaskCardReplyContractBlock(normalized, fixedTaskTitle) {
  return [
    '[Task-card reply contract]',
    'After every user-facing reply, append exactly one final hidden <private><task_card> JSON block at the very end of the reply.',
    'Keep the normal answer natural and user-facing. Put the hidden task-card block after that answer so the client can update the session task bar and branch recommendations without leaking raw JSON into the visible reply.',
    'Never append raw task-card JSON directly to the visible prose body.',
    'Use literal closing tags exactly as </task_card> and </private>. Do not escape the slash as <\\/task_card> or <\\/private>.',
    'The <task_card> JSON must use these keys: mode, summary, goal, mainGoal, lineRole, branchFrom, branchReason, checkpoint, candidateBranches, knownConclusions, memory.',
    fixedTaskTitle
      ? 'For main-line turns, keep goal and mainGoal anchored to the fixed session task title unless the user explicitly redefines the whole task.'
      : '',
    'For a newly started main task, use summary as a short task-bar subtitle rather than a full sentence description.',
    'Keep summary to no more than 10 Chinese characters when possible; prefer 6-8.',
    'Treat summary as a short directional title, not a sentence. Prefer a compact verb + object form.',
    'Do not use summary for background, reasoning, process notes, uncertainty, or implementation detail.',
    'Only rewrite summary when the session-level task framing materially changes.',
    'Set lineRole to "main" when the conversation is still pushing the current main line. Set it to "branch" only when the user has clearly drifted into a side line that should be remembered separately.',
    'Set mainGoal to the main line that should remain visible even when the conversation is currently on a branch. If there is no branch, set mainGoal equal to the fixed session task title or goal.',
    'Set branchFrom to the main line or parent line the current branch diverged from. Leave branchFrom empty when lineRole is "main".',
    'Set branchReason only when there is a clear reason a branch already exists or should split out, such as a distinct deliverable, a different research track, or a line that would pollute the current context if kept in the same thread.',
    'Set checkpoint to one short resume hint that would let the user or the system continue later without rereading the full history.',
    'Set knownConclusions to at most 3-4 short items that record key decisions or confirmed facts that would otherwise be forgotten — things the session has definitively settled that are worth carrying forward. Do not list every step taken or every sub-question answered. Leave knownConclusions empty if nothing has been firmly decided yet.',
    'Default candidateBranches to an empty list.',
    'Add candidateBranches when the user has already started drifting into a different goal or when there are clear independent side lines that are likely to deserve their own branch next.',
    'Use candidateBranches for branch recommendations only. Do not change the main task title just because a candidate branch appeared.',
    'Do not proactively suggest a branch for normal follow-up questions, refinements, examples, reordering, polishing, style tweaks, or deeper explanation inside the same deliverable.',
    'Keep candidateBranches concise and reserve them for the strongest likely side lines. If there is any doubt, leave candidateBranches empty.',
    'Use candidateBranches only for likely side lines that would be worth splitting later because they are independent and would otherwise pollute the current context. Keep each item short and actionable. Do not list every sub-question, routine refinement, or the full task map there.',
    normalized?.mode === 'project'
      ? 'This session is already in project mode. Own the workspace, notes, artifacts, and intermediate outputs without asking the user to organize them.'
      : 'This session is still in lightweight task mode. Keep the summary, next step, and checkpoint current without making the user manage project structure.',
  ].filter(Boolean).join('\n\n');
}

export function buildTaskCardPromptBlock(taskCard, options = {}) {
  const normalized = normalizeSessionTaskCard(taskCard);
  const fixedTaskTitle = clipText(options?.sessionTitle || options?.taskTitle || '', 160);
  return [
    buildTaskCardStateBlock(normalized, fixedTaskTitle),
    buildTaskCardReplyContractBlock(normalized, fixedTaskTitle),
  ].filter(Boolean).join('\n\n---\n\n');
}

export function projectTaskCardFromSessionState(sessionState, options = {}) {
  const goal = clipText(
    sessionState?.goal || options?.sessionTitle || options?.taskTitle || '',
    MAX_TASK_CARD_GOAL_CHARS,
  );
  const mainGoal = clipText(
    sessionState?.mainGoal || goal || options?.sessionTitle || options?.taskTitle || '',
    MAX_TASK_CARD_GOAL_CHARS,
  );
  const checkpoint = clipText(sessionState?.checkpoint || '', MAX_TASK_CARD_TEXT_CHARS);
  const lineRole = normalizeTaskCardLineRole(sessionState?.lineRole || 'main');
  const branchFrom = lineRole === 'branch'
    ? clipText(sessionState?.branchFrom || mainGoal || goal || '', MAX_TASK_CARD_ITEM_CHARS)
    : '';

  if (!goal && !mainGoal && !checkpoint && lineRole === 'main' && !branchFrom) {
    return null;
  }

  return normalizeSessionTaskCard({
    mode: 'task',
    goal,
    mainGoal: mainGoal || goal,
    lineRole,
    branchFrom,
    checkpoint,
  });
}

export function parseTaskCardFromAssistantContent(content) {
  const block = extractTaggedBlock(content, TASK_CARD_TAG);
  if (block) {
    return normalizeSessionTaskCard(parseJsonObjectText(block));
  }
  const trailingTaskCard = extractTrailingTaskCardJsonBounds(content);
  return trailingTaskCard ? normalizeSessionTaskCard(trailingTaskCard.parsed) : null;
}

export function stripTaskCardFromAssistantContent(content) {
  let text = typeof content === 'string' ? content : '';
  if (!text) return '';

  text = text
    .replace(
      /<private>\s*<task_card>[\s\S]*?<(?:\\\/|\/)task_card>\s*<(?:\\\/|\/)private>/gi,
      '',
    )
    .replace(/<task_card>[\s\S]*?<(?:\\\/|\/)task_card>/gi, '')
    .replace(/<private>\s*<(?:\\\/|\/)private>/gi, '');

  const trailingTaskCard = extractTrailingTaskCardJsonBounds(text);
  if (trailingTaskCard) {
    text = `${text.slice(0, trailingTaskCard.start)}${text.slice(trailingTaskCard.end)}`;
  }

  return cleanupTaskCardGapText(text);
}

export { TASK_CARD_TAG };
