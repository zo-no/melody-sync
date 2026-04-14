import { normalizeSessionTaskCard } from '../session/task-card.mjs';
import { resolveSessionStateFromSession } from '../session-runtime/session-state.mjs';
import { trimText } from '../shared/text.mjs';
import { normalizePersistentKind } from '../session/persistent-kind.mjs';

const MAX_DIGEST_TEXT_CHARS = 280;
const MAX_DIGEST_ITEM_CHARS = 140;
const MAX_DIGEST_ITEMS = 6;
const MAX_MESSAGE_PREVIEW_CHARS = 120;
const MAX_LOOP_SOURCE_ITEMS = 8;
const MAX_LOOP_SOURCE_CHARS = 120;
const MAX_KNOWLEDGE_BASE_PATH_CHARS = 480;

function clipText(value, maxChars) {
  const text = trimText(String(value || '').replace(/\s+/g, ' '));
  if (!text || !Number.isInteger(maxChars) || maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  if (maxChars === 1) return '…';
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function normalizeIsoTimestamp(value) {
  const text = trimText(value);
  if (!text) return '';
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function normalizeList(value, { maxItems = MAX_DIGEST_ITEMS, maxChars = MAX_DIGEST_ITEM_CHARS } = {}) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'string' && value.trim() ? value.split(/\n+/) : []);
  const items = [];
  const seen = new Set();
  for (const raw of source) {
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

function normalizePersistentState(value) {
  const normalized = trimText(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (['paused', 'pause', 'inactive'].includes(normalized)) return 'paused';
  return 'active';
}

function normalizeRuntimePolicyMode(value, allowedModes = [], fallback = '') {
  const normalized = trimText(value).toLowerCase().replace(/[\s-]+/g, '_');
  return allowedModes.includes(normalized) ? normalized : fallback;
}

function normalizeRuntimeSnapshot(value, fallback = null) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallbackSource = fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};
  const requestedTool = trimText(source.tool || '');
  const fallbackTool = trimText(fallbackSource.tool || '');
  const tool = requestedTool || fallbackTool;
  if (!tool) return null;
  const canInheritFallback = !requestedTool || requestedTool === fallbackTool;
  return {
    tool,
    model: clipText(source.model || (canInheritFallback ? fallbackSource.model || '' : ''), 160),
    effort: clipText(source.effort || (canInheritFallback ? fallbackSource.effort || '' : ''), 80),
    thinking: Object.prototype.hasOwnProperty.call(source, 'thinking')
      ? source.thinking === true
      : (canInheritFallback ? fallbackSource.thinking === true : false),
  };
}

function getDefaultRuntimePolicy(kind, defaultRuntime = null) {
  const fallbackRuntime = normalizeRuntimeSnapshot(defaultRuntime);
  const policy = {
    manual: {
      mode: 'follow_current',
    },
  };
  if (kind && kind !== 'skill') {
    policy.schedule = {
      mode: fallbackRuntime ? 'pinned' : 'session_default',
      ...(fallbackRuntime ? { runtime: fallbackRuntime } : {}),
    };
  }
  return policy;
}

function normalizeRuntimeRule(
  value,
  {
    allowedModes = [],
    defaultMode = '',
    defaultRuntime = null,
  } = {},
) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const mode = normalizeRuntimePolicyMode(
    source.mode || source.strategy || source.type || '',
    allowedModes,
    defaultMode,
  );
  const normalized = { mode };
  if (mode === 'pinned') {
    const runtime = normalizeRuntimeSnapshot(
      source.runtime || source.pinnedRuntime || source.snapshot || null,
      defaultRuntime,
    );
    if (runtime) {
      normalized.runtime = runtime;
    }
  }
  return normalized;
}

function normalizePersistentRuntimePolicy(value, { kind, defaultRuntime } = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const fallbackPolicy = getDefaultRuntimePolicy(kind, defaultRuntime);
  const fallbackRuntime = normalizeRuntimeSnapshot(defaultRuntime);

  const manual = normalizeRuntimeRule(
    source.manual || {
      mode: source.manualMode || fallbackPolicy.manual?.mode || 'follow_current',
      runtime: source.manualRuntime || source.runtime || source.pinnedRuntime || null,
    },
    {
      allowedModes: ['follow_current', 'session_default', 'pinned'],
      defaultMode: fallbackPolicy.manual?.mode || 'follow_current',
      defaultRuntime: fallbackRuntime,
    },
  );

  const normalized = {
    manual: manual.mode === 'pinned' && !manual.runtime
      ? { mode: fallbackPolicy.manual?.mode || 'follow_current' }
      : manual,
  };

  if (kind && kind !== 'skill') {
    const scheduleFallbackMode = fallbackPolicy.schedule?.mode || 'session_default';
    const scheduleFallbackRuntime = fallbackPolicy.schedule?.runtime || fallbackRuntime;
    const schedule = normalizeRuntimeRule(
      source.schedule || {
        mode: source.scheduleMode || scheduleFallbackMode,
        runtime: source.scheduleRuntime || source.runtime || source.pinnedRuntime || null,
      },
      {
        allowedModes: ['session_default', 'pinned'],
        defaultMode: scheduleFallbackMode,
        defaultRuntime: scheduleFallbackRuntime,
      },
    );
    normalized.schedule = schedule.mode === 'pinned' && !schedule.runtime
      ? { mode: 'session_default' }
      : schedule;
  }

  return normalized;
}

function normalizeRecurringCadence(value) {
  const normalized = trimText(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'hourly') return 'hourly';
  if (normalized === 'weekly') return 'weekly';
  return 'daily';
}

function normalizeTimeOfDay(value) {
  const text = trimText(value);
  if (!text) return '';
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return '';
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return '';
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeKnowledgeBasePath(value) {
  return clipText(value || '', MAX_KNOWLEDGE_BASE_PATH_CHARS);
}

const MAX_WORKSPACE_PATH_CHARS = 480;
const MAX_WORKSPACE_LABEL_CHARS = 120;

function normalizeWorkspace(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const path = clipText(value.path || value.dir || value.folder || '', MAX_WORKSPACE_PATH_CHARS);
  if (!path) return null;
  return {
    path,
    label: clipText(value.label || value.name || '', MAX_WORKSPACE_LABEL_CHARS),
  };
}

function normalizeWeekdays(value) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'number' ? [value] : []);
  const normalized = [];
  const seen = new Set();
  for (const raw of source) {
    const weekday = typeof raw === 'number'
      ? raw
      : Number.parseInt(String(raw || '').trim(), 10);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || seen.has(weekday)) continue;
    seen.add(weekday);
    normalized.push(weekday);
  }
  normalized.sort((a, b) => a - b);
  return normalized;
}

function parseTimeOfDay(timeOfDay) {
  const normalized = normalizeTimeOfDay(timeOfDay);
  if (!normalized) return null;
  const [hourText, minuteText] = normalized.split(':');
  return {
    hour: Number.parseInt(hourText, 10),
    minute: Number.parseInt(minuteText, 10),
    normalized,
  };
}

function parseDate(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function buildDateAtLocalTime(baseDate, hour, minute) {
  const next = new Date(baseDate.getTime());
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  return next;
}

export function computeNextRecurringRunAt(recurring = {}, fromValue = new Date()) {
  const parsedFrom = parseDate(fromValue);
  if (!parsedFrom) return '';
  const cadence = normalizeRecurringCadence(recurring?.cadence || recurring?.type || '');
  const time = parseTimeOfDay(recurring?.timeOfDay || recurring?.time || '');
  if (!time) return '';

  if (cadence === 'hourly') {
    const candidate = new Date(parsedFrom.getTime());
    candidate.setSeconds(0, 0);
    candidate.setMinutes(time.minute);
    if (candidate.getTime() <= parsedFrom.getTime()) {
      candidate.setHours(candidate.getHours() + 1);
    }
    return candidate.toISOString();
  }

  if (cadence === 'weekly') {
    const weekdays = normalizeWeekdays(recurring?.weekdays);
    const targetDays = weekdays.length > 0 ? weekdays : [parsedFrom.getDay()];
    for (let offset = 0; offset < 14; offset += 1) {
      const candidateDate = new Date(parsedFrom.getTime());
      candidateDate.setDate(candidateDate.getDate() + offset);
      if (!targetDays.includes(candidateDate.getDay())) continue;
      const candidate = buildDateAtLocalTime(candidateDate, time.hour, time.minute);
      if (candidate.getTime() > parsedFrom.getTime()) {
        return candidate.toISOString();
      }
    }
    return '';
  }

  const sameDay = buildDateAtLocalTime(parsedFrom, time.hour, time.minute);
  if (sameDay.getTime() > parsedFrom.getTime()) {
    return sameDay.toISOString();
  }
  const nextDay = new Date(parsedFrom.getTime());
  nextDay.setDate(nextDay.getDate() + 1);
  return buildDateAtLocalTime(nextDay, time.hour, time.minute).toISOString();
}

function defaultRunPrompt(kind, digest = {}) {
  const title = clipText(digest?.title || digest?.goal || '当前长期项', 80);
  const summary = clipText(digest?.summary || '', 160);
  if (kind === 'recurring_task') {
    return clipText(
      `请按这个长期任务的沉淀定义执行本轮产出。先回忆沉淀摘要，再给出当前这一轮的结果。${title ? ` 任务：${title}。` : ''}${summary ? ` 摘要：${summary}` : ''}`,
      240,
    );
  }
  if (kind === 'scheduled_task') {
    return clipText(
      `请按这个短期任务的沉淀定义执行本轮产出。先回忆沉淀摘要，再完成这次定时任务。${title ? ` 任务：${title}。` : ''}${summary ? ` 摘要：${summary}` : ''}`,
      240,
    );
  }
  if (kind === 'waiting_task') {
    return clipText(
      `请按这个等待任务的沉淀定义执行当前触发。先回忆沉淀摘要，再明确本轮需要人类处理的事项和下一步。${title ? ` 任务：${title}。` : ''}${summary ? ` 摘要：${summary}` : ''}`,
      240,
    );
  }
  return clipText(
    `请按这个快捷按钮的沉淀定义执行当前触发。先回忆摘要，再完成这次执行。${title ? ` 名称：${title}。` : ''}${summary ? ` 摘要：${summary}` : ''}`,
    240,
  );
}

function normalizePersistentDigest(value, fallback = {}) {
  const digest = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  return {
    title: clipText(digest.title || fallback.title || '', 120),
    summary: clipText(digest.summary || fallback.summary || '', MAX_DIGEST_TEXT_CHARS),
    goal: clipText(digest.goal || fallback.goal || '', 180),
    keyPoints: normalizeList(digest.keyPoints || fallback.keyPoints),
    recipe: normalizeList(digest.recipe || fallback.recipe),
  };
}

function normalizeLoopInstruction(value, fallback = '') {
  return clipText(value || fallback || '', MAX_DIGEST_TEXT_CHARS);
}

function normalizeLoopSources(value, fallback = []) {
  return normalizeList(value || fallback, {
    maxItems: MAX_LOOP_SOURCE_ITEMS,
    maxChars: MAX_LOOP_SOURCE_CHARS,
  });
}

function normalizePersistentLoopStage(value, fallback = {}, { allowSources = false } = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const normalized = {
    instruction: normalizeLoopInstruction(
      source.instruction || source.prompt || source.note,
      fallback?.instruction || fallback?.prompt || fallback?.note || '',
    ),
  };
  if (allowSources) {
    normalized.sources = normalizeLoopSources(
      source.sources || source.items,
      fallback?.sources || fallback?.items || [],
    );
  }
  return normalized;
}

function normalizePersistentLoop(value, fallback = {}) {
  const loop = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const loopFallback = fallback && typeof fallback === 'object' && !Array.isArray(fallback)
    ? fallback
    : {};
  return {
    collect: normalizePersistentLoopStage(loop.collect, loopFallback.collect, { allowSources: true }),
    organize: normalizePersistentLoopStage(loop.organize, loopFallback.organize),
    use: normalizePersistentLoopStage(loop.use, loopFallback.use),
    prune: normalizePersistentLoopStage(loop.prune, loopFallback.prune),
  };
}

function normalizePersistentExecution(value, { kind, digest } = {}) {
  const execution = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const mode = trimText(execution.mode).toLowerCase() === 'spawn_session'
    ? 'spawn_session'
    : 'in_place';
  // shellCommand: optional shell script to run before (or instead of) the AI prompt
  const shellCommand = trimText(execution.shellCommand || execution.shell_command || '');
  // maxTurns: safety cap on agent turns per run. 0 = unlimited (default for manual).
  // Auto-triggered runs (recurring/schedule) default to 40 if not set.
  const rawMaxTurns = parseInt(String(execution.maxTurns ?? execution.max_turns ?? ''), 10);
  const maxTurns = Number.isFinite(rawMaxTurns) && rawMaxTurns > 0 ? rawMaxTurns : 0;
  const result = {
    mode,
    runPrompt: clipText(execution.runPrompt || defaultRunPrompt(kind, digest), 4000),
    lastTriggerAt: normalizeIsoTimestamp(execution.lastTriggerAt),
    lastTriggerKind: (() => {
      const normalized = trimText(execution.lastTriggerKind).toLowerCase();
      if (normalized === 'recurring') return 'recurring';
      if (normalized === 'schedule') return 'schedule';
      if (normalized === 'manual') return 'manual';
      return '';
    })(),
  };
  if (shellCommand) result.shellCommand = shellCommand;
  if (maxTurns > 0) result.maxTurns = maxTurns;
  // freshThread: if true, do not resume the previous provider session (start a clean context)
  if (execution.freshThread === true) result.freshThread = true;
  return result;
}

function normalizePersistentScheduled(value, options = {}) {
  const scheduled = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const hasExplicitNextRunAt = Object.prototype.hasOwnProperty.call(scheduled, 'nextRunAt');
  const explicitNextRunAt = hasExplicitNextRunAt ? normalizeIsoTimestamp(scheduled.nextRunAt) : '';
  const runAt = normalizeIsoTimestamp(
    scheduled.runAt
    || scheduled.at
    || scheduled.dateTime
    || explicitNextRunAt,
  );
  if (!runAt) return null;
  return {
    runAt,
    timezone: clipText(scheduled.timezone || options.defaultTimezone || '', 80),
    nextRunAt: hasExplicitNextRunAt ? explicitNextRunAt : runAt,
    lastRunAt: normalizeIsoTimestamp(scheduled.lastRunAt),
  };
}

function normalizePersistentRecurring(value, options = {}) {
  const recurring = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const cadence = normalizeRecurringCadence(recurring.cadence || recurring.type || '');
  const timeOfDay = normalizeTimeOfDay(recurring.timeOfDay || recurring.time || '');
  if (!timeOfDay) return null;
  const normalized = {
    cadence,
    timeOfDay,
    weekdays: cadence === 'weekly' ? normalizeWeekdays(recurring.weekdays) : [],
    timezone: clipText(recurring.timezone || options.defaultTimezone || '', 80),
    nextRunAt: normalizeIsoTimestamp(recurring.nextRunAt),
    lastRunAt: normalizeIsoTimestamp(recurring.lastRunAt),
  };
  if (options.recomputeNextRunAt || !normalized.nextRunAt) {
    normalized.nextRunAt = computeNextRecurringRunAt(normalized, options.referenceTime || new Date());
  }
  return normalized;
}

export function normalizeSessionPersistent(value, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const kind = normalizePersistentKind(value.kind || value.type || '');
  if (!kind) return null;

  const digest = normalizePersistentDigest(value.digest, options.defaultDigest || {});
  const defaultRuntime = normalizeRuntimeSnapshot(
    options.defaultRuntime || value.runtime || value.execution?.runtime || null,
  );
  const normalized = {
    version: 1,
    kind,
    state: normalizePersistentState(value.state),
    promotedAt: normalizeIsoTimestamp(value.promotedAt || options.now),
    updatedAt: normalizeIsoTimestamp(value.updatedAt || options.now),
    digest,
    execution: normalizePersistentExecution(value.execution, { kind, digest }),
    runtimePolicy: normalizePersistentRuntimePolicy(value.runtimePolicy, {
      kind,
      defaultRuntime,
    }),
  };

  if (kind !== 'skill') {
    const scheduled = normalizePersistentScheduled(value.scheduled, options);
    const recurringSource = value.recurring
      || ((value.schedule && typeof value.schedule === 'object' && !Array.isArray(value.schedule) && value.schedule.timeOfDay)
        ? value.schedule
        : null);
    const recurring = normalizePersistentRecurring(recurringSource, options);
    const knowledgeBasePath = normalizeKnowledgeBasePath(
      value.knowledgeBasePath
      || value.knowledgeBase?.path
      || value.filePath
      || '',
    );

    if (kind === 'recurring_task' && !recurring) return null;
    if (kind === 'scheduled_task' && !scheduled) return null;

    if (scheduled) {
      normalized.scheduled = scheduled;
    }
    if (recurring) {
      normalized.recurring = recurring;
    }
    if (knowledgeBasePath) {
      normalized.knowledgeBasePath = knowledgeBasePath;
    }
    const workspace = normalizeWorkspace(value.workspace || null);
    if (workspace) {
      normalized.workspace = workspace;
    }
    normalized.loop = normalizePersistentLoop(value.loop, options.defaultLoop);
  } else {
    const skill = value.skill && typeof value.skill === 'object' && !Array.isArray(value.skill)
      ? value.skill
      : {};
    const lastUsedAt = normalizeIsoTimestamp(skill.lastUsedAt || value.lastUsedAt);
    if (lastUsedAt) {
      normalized.skill = { lastUsedAt };
    }
  }

  return normalized;
}

function extractUserMessagePreviews(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter((event) => event?.type === 'message' && event?.role === 'user')
    .map((event) => clipText(event?.content || '', MAX_MESSAGE_PREVIEW_CHARS))
    .filter(Boolean);
}

export function buildPersistentDigest(session = {}, history = []) {
  const taskCard = normalizeSessionTaskCard(session?.taskCard || {}) || {};
  const sessionState = resolveSessionStateFromSession(session) || {};
  const explicitSessionState = session?.sessionState && typeof session.sessionState === 'object' && !Array.isArray(session.sessionState)
    ? session.sessionState
    : {};
  const userMessagePreviews = extractUserMessagePreviews(history);
  const stateMainGoal = clipText(sessionState.mainGoal || '', 120);
  const stateGoal = clipText(sessionState.goal || '', 180);
  const stateCheckpoint = clipText(sessionState.checkpoint || '', MAX_DIGEST_TEXT_CHARS);
  const explicitStateCheckpoint = clipText(explicitSessionState.checkpoint || '', MAX_DIGEST_TEXT_CHARS);
  const title = clipText(
    session?.name
      || stateMainGoal
      || taskCard.mainGoal
      || stateGoal
      || taskCard.goal
      || '',
    120,
  );
  const goal = clipText(
    stateGoal
      || stateMainGoal
      || taskCard.goal
      || taskCard.mainGoal
      || title,
    180,
  );
  const summary = clipText(
    stateCheckpoint
      || taskCard.checkpoint
      || taskCard.goal
      || taskCard.mainGoal
      || session?.description
      || userMessagePreviews.at(-1)
      || title,
    MAX_DIGEST_TEXT_CHARS,
  );
  const keyPoints = normalizeList([
    ...(Array.isArray(taskCard?.knownConclusions) ? taskCard.knownConclusions : []),
    ...(userMessagePreviews.length > 0 && !(taskCard?.knownConclusions || []).length
      ? userMessagePreviews.slice(-3)
      : []),
  ]);
  const recipe = normalizeList([
    ...((taskCard?.checkpoint || explicitStateCheckpoint) ? [taskCard.checkpoint || explicitStateCheckpoint] : []),
  ]);
  return {
    title,
    summary,
    goal,
    keyPoints,
    recipe,
  };
}

export function isPersistentRecurringDue(persistent, nowValue = new Date()) {
  if (!persistent || persistent.state !== 'active') return false;
  const nextRunAt = normalizeIsoTimestamp(persistent?.recurring?.nextRunAt);
  if (!nextRunAt) return false;
  const now = parseDate(nowValue);
  const dueAt = parseDate(nextRunAt);
  if (!now || !dueAt) return false;
  return dueAt.getTime() <= now.getTime();
}

export function isPersistentScheduledDue(persistent, nowValue = new Date()) {
  if (!persistent || persistent.state !== 'active') return false;
  const scheduled = persistent?.scheduled && typeof persistent.scheduled === 'object' && !Array.isArray(persistent.scheduled)
    ? persistent.scheduled
    : {};
  const hasExplicitNextRunAt = Object.prototype.hasOwnProperty.call(scheduled, 'nextRunAt');
  const nextRunAt = normalizeIsoTimestamp(hasExplicitNextRunAt ? scheduled.nextRunAt : scheduled.runAt);
  if (!nextRunAt) return false;
  const now = parseDate(nowValue);
  const dueAt = parseDate(nextRunAt);
  if (!now || !dueAt) return false;
  return dueAt.getTime() <= now.getTime();
}

export function resolvePersistentDueTriggerKind(persistent, nowValue = new Date()) {
  if (isPersistentScheduledDue(persistent, nowValue)) return 'schedule';
  if (isPersistentRecurringDue(persistent, nowValue)) return 'recurring';
  return '';
}

export function buildPersistentRunMessage(session = {}, persistent = {}, options = {}) {
  const liveDigest = buildPersistentDigest(session);
  // Use stored digest for stable fields (title, summary, goal set at promote time),
  // but always use live keyPoints so task_card.knownConclusions from the latest run
  // flow into the next trigger's context without requiring a digest rebuild.
  const digest = normalizePersistentDigest(
    {
      ...(persistent?.digest || {}),
      keyPoints: liveDigest.keyPoints.length > 0 ? liveDigest.keyPoints : persistent?.digest?.keyPoints,
      recipe: liveDigest.recipe.length > 0 ? liveDigest.recipe : persistent?.digest?.recipe,
    },
    liveDigest,
  );
  const loop = normalizePersistentLoop(persistent?.loop);
  const runPrompt = clipText(
    options.runPrompt
      || persistent?.execution?.runPrompt
      || defaultRunPrompt(persistent?.kind, digest),
    4000,
  );
  const normalizedTriggerKind = trimText(options.triggerKind).toLowerCase();
  const isRecurring = normalizedTriggerKind === 'recurring';
  const isSchedule = normalizedTriggerKind === 'schedule';
  const loopSections = [];
  if ((loop.collect?.sources || []).length > 0 || loop.collect?.instruction) {
    const collectLines = [];
    if ((loop.collect?.sources || []).length > 0) {
      collectLines.push(`- 数据来源：${loop.collect.sources.join(' · ')}`);
    }
    if (loop.collect?.instruction) {
      collectLines.push(`- 收集要求：${loop.collect.instruction}`);
    }
    loopSections.push(`数据收集：\n${collectLines.join('\n')}`);
  }
  if (loop.organize?.instruction) {
    loopSections.push(`数据整理：\n- 整理要求：${loop.organize.instruction}`);
  }
  if (loop.use?.instruction) {
    loopSections.push(`数据使用：\n- 使用要求：${loop.use.instruction}`);
  }
  if (loop.prune?.instruction) {
    loopSections.push(`冗余减枝：\n- 减枝要求：${loop.prune.instruction}`);
  }
  if (persistent?.knowledgeBasePath) {
    loopSections.push(`知识库路径：\n- ${persistent.knowledgeBasePath}`);
  }
  if (persistent?.workspace?.path) {
    const workspaceLabel = persistent.workspace.label
      ? `${persistent.workspace.label}（${persistent.workspace.path}）`
      : persistent.workspace.path;
    loopSections.push(`工作区目录：\n- ${workspaceLabel}\n- 执行任务时以此目录为工作根，可读写其中文件。`);
  }
  const taskName = digest.title || session?.name || '未命名任务';
  const titleByKind = (
    persistent?.kind === 'recurring_task'
      ? (isRecurring ? `[定时执行] ${taskName}` : `[触发执行] ${taskName}`)
      : persistent?.kind === 'scheduled_task'
        ? `[单次执行] ${taskName}`
        : persistent?.kind === 'waiting_task'
          ? `[触发执行] ${taskName}`
          : `[触发执行] ${taskName}`
  );
  const lines = [
    titleByKind,
    digest.summary ? `摘要：${digest.summary}` : '',
    digest.goal ? `目标：${digest.goal}` : '',
    digest.keyPoints.length > 0 ? `核心记录：\n- ${digest.keyPoints.join('\n- ')}` : '',
    digest.recipe.length > 0 ? `执行提示：\n- ${digest.recipe.join('\n- ')}` : '',
    ...loopSections,
    runPrompt,
  ].filter(Boolean);
  return lines.join('\n\n');
}

export function resolvePersistentRunRuntime(session = {}, persistent = {}, options = {}) {
  const sessionRuntime = normalizeRuntimeSnapshot(session);
  const normalizedPersistent = normalizeSessionPersistent(persistent, {
    defaultDigest: buildPersistentDigest(session),
    defaultRuntime: sessionRuntime,
    defaultTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
  });
  if (!normalizedPersistent) {
    return sessionRuntime;
  }
  const requestedTriggerKind = trimText(options.triggerKind).toLowerCase();
  const triggerKind = requestedTriggerKind === 'schedule' || requestedTriggerKind === 'recurring'
    ? 'schedule'
    : 'manual';
  const requestedRuntime = normalizeRuntimeSnapshot(options.runtime, sessionRuntime);
  const runtimeRule = triggerKind === 'schedule'
    ? normalizedPersistent?.runtimePolicy?.schedule || { mode: 'session_default' }
    : normalizedPersistent?.runtimePolicy?.manual || { mode: 'follow_current' };
  if (triggerKind === 'manual' && runtimeRule.mode === 'follow_current') {
    return requestedRuntime || sessionRuntime;
  }
  if (runtimeRule.mode === 'pinned') {
    return normalizeRuntimeSnapshot(runtimeRule.runtime, sessionRuntime) || sessionRuntime;
  }
  return sessionRuntime;
}
