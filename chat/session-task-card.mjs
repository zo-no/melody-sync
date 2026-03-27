const TASK_CARD_TAG = 'task_card';
const MAX_TASK_CARD_TEXT_CHARS = 360;
const MAX_TASK_CARD_ITEM_CHARS = 180;
const MAX_TASK_CARD_ITEMS = 5;

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
  const match = text.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\/${tagName}>`, 'i'));
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

function hasMeaningfulTaskCard(card) {
  if (!card || typeof card !== 'object') return false;
  return Boolean(
    card.goal
    || card.mainGoal
    || card.summary
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

export function normalizeSessionTaskCard(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const summary = clipText(value.summary || value.taskSummary || value.brief || '', MAX_TASK_CARD_TEXT_CHARS);
  const goal = clipText(value.goal || value.objective || '', 240);
  const mainGoal = clipText(value.mainGoal || value.primaryGoal || value.mainlineGoal || '', 240);
  const lineRole = normalizeTaskCardLineRole(value.lineRole || value.branchState || value.threadRole);
  const branchFrom = clipText(value.branchFrom || value.parentGoal || value.mainline || '', MAX_TASK_CARD_ITEM_CHARS);
  const branchReason = clipText(value.branchReason || value.driftReason || '', MAX_TASK_CARD_ITEM_CHARS);
  const checkpoint = clipText(value.checkpoint || value.resumePoint || value.returnPoint || value.reentryPoint || '', MAX_TASK_CARD_TEXT_CHARS);
  const candidateBranches = normalizeTaskCardList(
    value.candidateBranches || value.branchCandidates || value.sideQuests || value.sideLines,
    { maxItems: 3, maxChars: 120 },
  );
  const background = normalizeTaskCardList(value.background || value.context || value.backgroundNotes);
  const rawMaterials = normalizeTaskCardList(value.rawMaterials || value.materials || value.sourceMaterials);
  const assumptions = normalizeTaskCardList(value.assumptions);
  const knownConclusions = normalizeTaskCardList(
    value.knownConclusions || value.conclusions || value.knownFindings || value.findings,
  );
  const nextSteps = normalizeTaskCardList(value.nextSteps || value.nextActions || value.plan);
  const memory = normalizeTaskCardList(value.memory || value.userMemory || value.reusableContext || value.durableMemory);
  const needsFromUser = normalizeTaskCardList(
    value.needsFromUser || value.openQuestions || value.blockers || value.missingInputs,
  );
  const mode = normalizeTaskCardMode(
    value.mode
    || value.executionMode
    || value.projectState
    || value.projectMode,
  ) || (
    rawMaterials.length >= 3
    || nextSteps.length >= 2
    || background.length >= 2
      ? 'project'
      : 'task'
  );

  const normalized = {
    version: 1,
    mode,
    summary,
    goal,
    mainGoal: mainGoal || goal,
    lineRole,
    branchFrom: lineRole === 'branch' ? (branchFrom || mainGoal || goal) : '',
    branchReason: lineRole === 'branch' ? branchReason : '',
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

  return hasMeaningfulTaskCard(normalized) ? normalized : null;
}

function formatTaskCardList(label, items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return `${label}:\n${items.map((item) => `- ${item}`).join('\n')}`;
}

export function buildTaskCardPromptBlock(taskCard) {
  const normalized = normalizeSessionTaskCard(taskCard);
  const currentCardBlock = normalized
    ? [
        'Current carried task card (hidden session memory; keep this updated silently):',
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
      ].filter(Boolean).join('\n\n')
    : '';

  return [
    currentCardBlock,
    'After every user-facing reply, append a hidden <private> block that contains exactly one <task_card> JSON object and nothing else inside that hidden block.',
    'The <task_card> JSON must use these keys: mode, summary, goal, mainGoal, lineRole, branchFrom, branchReason, checkpoint, candidateBranches, background, rawMaterials, assumptions, knownConclusions, nextSteps, memory, needsFromUser.',
    'Set lineRole to "main" when the conversation is still pushing the current main line. Set it to "branch" only when the user has clearly drifted into a side line that should be remembered separately.',
    'Set mainGoal to the main line that should remain visible even when the conversation is currently on a branch. If there is no branch, set mainGoal equal to goal.',
    'Set branchFrom to the main line or parent line the current branch diverged from. Leave branchFrom empty when lineRole is "main".',
    'Set branchReason only when the branch exists for a clear reason, such as following a related book, concept, dependency, or prerequisite.',
    'Set checkpoint to one short resume hint that would let the user or the system continue later without rereading the full history.',
    'Use candidateBranches only for likely side lines that would be worth splitting into their own branch later. Keep each item short and actionable. Do not list every sub-question.',
    normalized?.mode === 'project'
      ? 'This session is already in project mode. Own the workspace, notes, artifacts, and intermediate outputs without asking the user to organize them.'
      : 'This session is still in lightweight task mode. Keep the summary, next step, and checkpoint current without making the user manage project structure.',
  ].filter(Boolean).join('\n\n');
}

export function parseTaskCardFromAssistantContent(content) {
  const block = extractTaggedBlock(content, TASK_CARD_TAG);
  if (!block) return null;
  return normalizeSessionTaskCard(parseJsonObjectText(block));
}

export { TASK_CARD_TAG };
