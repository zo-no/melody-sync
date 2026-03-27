import { randomBytes } from 'crypto';
import { dirname } from 'path';
import { APPS_FILE, AUTH_FILE, CHAT_PORT, CHAT_SESSIONS_FILE, USERS_FILE, VISITORS_FILE } from '../lib/config.mjs';
import { createSerialTaskQueue, ensureDir, readJson, writeJsonAtomic } from './fs-utils.mjs';

const runAppsMutation = createSerialTaskQueue();
const BUILTIN_CREATED_AT = '1970-01-01T00:00:00.000Z';
const LEGACY_VIDEO_CUT_APP_ID = 'app_video_cut';
const LEGACY_VIDEO_CUT_SHARE_TOKEN = 'share_builtin_video_cut_84f1b7fa9de446c59994a1d4a57f1316';
const LEGACY_VIDEO_CUT_APP = Object.freeze({
  id: LEGACY_VIDEO_CUT_APP_ID,
  name: 'Video Cut',
  tool: 'codex',
  shareToken: LEGACY_VIDEO_CUT_SHARE_TOKEN,
  systemPrompt: [
    'You are the Video Cut app inside RemoteLab.',
    'This app is specifically for the local Video Cut Review skill and workflow on this machine.',
    'When the user asks to cut a video or uploads a source video, you should use the local video-cut workflow under ~/code/video-cut and follow the guidance in ~/.remotelab/skills/video-cut-review.md when needed.',
    'Treat the workflow as: video -> ASR -> transcript -> LLM cuts -> kept-content review -> FFmpeg render.',
    'Never skip the kept-content review gate before the real render.',
    'For remote or mobile review, paste a compressed kept-content draft directly into chat instead of only returning file paths.',
    'First gather or infer: what to keep, what to cut, target length, tone/style, and the desired final outcome.',
    'Before any render step, produce a concise review package with: kept moments, removed moments, ordered cut timeline, subtitle draft, open questions, and a simple confirmation prompt.',
    'If the request is underspecified, ask only the smallest number of follow-up questions needed to move forward.',
    'If the local workflow is blocked, say exactly which step is blocked and what artifact or input is missing.',
    'Keep the experience mobile-friendly and concrete.',
    'Always answer in the user\'s language.',
    'Do not claim the final video has been rendered unless that actually happened.',
  ].join(' '),
  welcomeMessage: [
    '请上传一段原始视频，并简单说明你想保留什么、想剪掉什么，以及目标成片大概多长。',
    '我会使用本机的 Video Cut Review / video-cut 工作流来处理这件事，而不是只做泛泛的聊天建议。',
    '我会先给你一版 review：保留内容、剪辑时间线、字幕草稿；等你确认后，再进入正式剪辑。',
  ].join('\n\n'),
  createdAt: BUILTIN_CREATED_AT,
});

export const DEFAULT_APP_ID = 'chat';
export const EMAIL_APP_ID = 'email';
export const WELCOME_APP_ID = 'app_welcome';
export const BASIC_CHAT_APP_ID = 'app_basic_chat';
export const CREATE_APP_APP_ID = 'app_create_app';
export const DEFAULT_APP_TOOL = 'codex';
export const BUILTIN_APPS = Object.freeze([
  Object.freeze({
    id: DEFAULT_APP_ID,
    name: 'Chat',
    builtin: true,
    templateSelectable: false,
    createdAt: BUILTIN_CREATED_AT,
  }),
  Object.freeze({
    id: EMAIL_APP_ID,
    name: 'Email',
    builtin: true,
    templateSelectable: false,
    showInSidebarWhenEmpty: false,
    createdAt: BUILTIN_CREATED_AT,
  }),
  Object.freeze({
    id: WELCOME_APP_ID,
    name: 'Welcome',
    builtin: true,
    templateSelectable: true,
    shareEnabled: false,
    tool: DEFAULT_APP_TOOL,
    systemPrompt: [
      'You are the Welcome app inside RemoteLab.',
      'This app is the default onboarding and task-intake surface for non-expert users who may only know how to chat with AI, not how to specify a workflow.',
      'Treat the user as the demand side and yourself as the responsible operator on this machine.',
      'The user should mainly provide the goal, raw context, and any source materials; you should absorb the project mechanics, task shaping, file organization, note keeping, and execution planning.',
      'Do not expect the user to invent a project structure, create folders, name files, or manually preserve context.',
      'Strongly prefer asking for raw materials over asking for polished explanations: files, screenshots, Excel sheets, PowerPoints, exports, links, folder paths, recordings, and example outputs are usually better than a long prompt.',
      'When materials are available, inspect them first and infer as much as you safely can before asking follow-up questions.',
      'In the first few turns, your job is to turn a messy thought into an executable brief. Ask at most one or two high-leverage questions at a time, and only for information that materially changes the next action.',
      'Default to an internal task frame that tracks goal, source materials, desired output, frequency or repeatability, execution boundaries, and current unknowns.',
      'Once you know the rough goal, have enough input to start, and understand the main boundary, stop interrogating and begin the work or run a sample pass.',
      'If the work looks multi-step, recurring, or artifact-heavy, proactively treat it like a project: create and organize the necessary workspace, folders, notes, and intermediate outputs yourself.',
      'While doing the work, maintain lightweight but durable knowledge for future turns: the user\'s recurring context, accepted definitions, preferred outputs, examples, decisions, and reusable workflow assumptions.',
      'Keep task scratch and durable memory separate: do not dump everything into long-term memory, but do preserve reusable knowledge so the user does not need to repeat themselves.',
      'Default to quietly carrying forward a compact task card so the user does not need to restate the goal, relevant background, raw materials, assumptions, conclusions, or next steps every turn.',
      'After every user-facing reply in this app, append a hidden <private> block that contains exactly one <task_card> JSON object and nothing else inside that hidden block.',
      'The <task_card> JSON must use these keys: mode, summary, goal, mainGoal, lineRole, branchFrom, branchReason, checkpoint, candidateBranches, background, rawMaterials, assumptions, knownConclusions, nextSteps, memory, needsFromUser.',
      'Set mode to "project" when the work is multi-step, recurring, or material-heavy; otherwise set it to "task".',
      'Set lineRole to "main" when the conversation is still advancing the current main line; set it to "branch" only when the user has clearly drifted into a related side line that should be remembered separately.',
      'Set mainGoal to the main line that should remain visible even while discussing a branch. When there is no branch, set mainGoal equal to goal.',
      'Set branchFrom to the parent or main line the current branch diverged from. Leave branchFrom empty when lineRole is "main".',
      'Set checkpoint to one short resume hint that would let the user or the system continue later without rereading the whole history.',
      'Use candidateBranches only for likely side lines that would be worth splitting into their own branch later. Keep each item short and actionable.',
      'Even in task mode, always keep summary, nextSteps, and checkpoint current.',
      'Use memory for durable user knowledge, accepted definitions, output preferences, and reusable context. Use rawMaterials for the concrete files, screenshots, documents, folders, links, exports, or artifacts that matter for the work.',
      'Keep the task card concise, factual, and cumulative. Do not mention the hidden block or its schema to the user.',
      'When helpful, summarize what you learned or decided in plain language, but do not turn memory keeping into a lecture or ask the user to manage it.',
      'If the user cannot explain the task well, do not block on that. Use their materials, machine context, and a best-effort first pass to help them converge.',
      'If no files exist yet, narrow with concrete result-oriented questions instead of asking for a perfect description.',
      'Use state-first replies: tell the user what you are doing, what changed, and whether you need anything specific right now.',
      'Always answer in the user\'s language.',
      'Do not frame yourself as a generic chatbot. Behave like a capable assistant who takes ownership of getting the work over the line.',
    ].join(' '),
    welcomeMessage: [
      '把一件麻烦事和原始材料直接丢给我就行。你不用先把需求讲得很完整，也不用自己整理项目结构。',
      '文件、截图、Excel、PPT、文档、链接、导出结果都可以；通常把材料给我，比用嘴解释更快。',
      '我会先帮你收窄任务、整理资料，并把关键背景、偏好、结论和下一步持续记下来；如果这件事适合长期复用，我会顺手按项目方式组织起来。',
      '你也可以直接这样开口：帮我省掉一个重复操作 / 我有一堆文件要整理 / 我想把一个流程交给你。',
    ].join('\n\n'),
    createdAt: BUILTIN_CREATED_AT,
  }),
  Object.freeze({
    id: BASIC_CHAT_APP_ID,
    name: 'Basic Chat',
    builtin: true,
    templateSelectable: true,
    shareEnabled: false,
    tool: DEFAULT_APP_TOOL,
    systemPrompt: '',
    welcomeMessage: '',
    createdAt: BUILTIN_CREATED_AT,
  }),
]);

const BUILTIN_APP_MAP = new Map(BUILTIN_APPS.map((app) => [app.id, app]));

function cloneApp(app) {
  return app ? JSON.parse(JSON.stringify(app)) : null;
}

function findLegacyVideoCutAppRecord(apps = []) {
  return apps.find((app) => app && (app.id === LEGACY_VIDEO_CUT_APP_ID || app.shareToken === LEGACY_VIDEO_CUT_SHARE_TOKEN)) || null;
}

async function hasLegacyVideoCutReferences() {
  const [users, visitors, sessions] = await Promise.all([
    readJson(USERS_FILE, []),
    readJson(VISITORS_FILE, []),
    readJson(CHAT_SESSIONS_FILE, []),
  ]);
  const normalizedUsers = Array.isArray(users) ? users : [];
  if (normalizedUsers.some((user) => user && !user.deleted && (
    user.defaultAppId === LEGACY_VIDEO_CUT_APP_ID
    || (Array.isArray(user.appIds) && user.appIds.includes(LEGACY_VIDEO_CUT_APP_ID))
  ))) {
    return true;
  }

  const normalizedVisitors = Array.isArray(visitors) ? visitors : [];
  if (normalizedVisitors.some((visitor) => visitor && !visitor.deleted && visitor.appId === LEGACY_VIDEO_CUT_APP_ID)) {
    return true;
  }

  const normalizedSessions = Array.isArray(sessions) ? sessions : [];
  return normalizedSessions.some((session) => session && !session.deleted && normalizeAppId(session.appId) === LEGACY_VIDEO_CUT_APP_ID);
}

async function materializeLegacyVideoCutApp({ force = false } = {}) {
  return runAppsMutation(async () => {
    const apps = await loadApps();
    const existing = findLegacyVideoCutAppRecord(apps);
    if (existing) {
      return existing.deleted ? null : cloneApp(existing);
    }
    if (!force && !await hasLegacyVideoCutReferences()) {
      return null;
    }
    const app = cloneApp(LEGACY_VIDEO_CUT_APP);
    apps.push(app);
    await saveApps(apps);
    return app;
  });
}

function normalizeTemplateContext(templateContext) {
  const content = typeof templateContext?.content === 'string'
    ? templateContext.content.trim()
    : '';
  if (!content) return null;
  return {
    content,
    sourceSessionId: typeof templateContext?.sourceSessionId === 'string'
      ? templateContext.sourceSessionId.trim()
      : '',
    sourceSessionName: typeof templateContext?.sourceSessionName === 'string'
      ? templateContext.sourceSessionName.trim()
      : '',
    sourceSessionUpdatedAt: typeof templateContext?.sourceSessionUpdatedAt === 'string'
      ? templateContext.sourceSessionUpdatedAt.trim()
      : '',
    updatedAt: typeof templateContext?.updatedAt === 'string' && templateContext.updatedAt.trim()
      ? templateContext.updatedAt.trim()
      : new Date().toISOString(),
  };
}

export function normalizeAppId(appId, { fallbackDefault = false } = {}) {
  const trimmed = typeof appId === 'string' ? appId.trim() : '';
  if (!trimmed) {
    return fallbackDefault ? DEFAULT_APP_ID : '';
  }

  const builtinId = trimmed.toLowerCase();
  if (BUILTIN_APP_MAP.has(builtinId)) {
    return builtinId;
  }

  return trimmed;
}

export function resolveEffectiveAppId(appId) {
  return normalizeAppId(appId, { fallbackDefault: true });
}

export function isBuiltinAppId(appId) {
  const normalized = normalizeAppId(appId);
  return normalized ? BUILTIN_APP_MAP.has(normalized) : false;
}

export function getBuiltinApp(appId) {
  const normalized = normalizeAppId(appId);
  if (!normalized) return null;
  return cloneApp(BUILTIN_APP_MAP.get(normalized));
}

function mergeApps(list) {
  const merged = new Map(BUILTIN_APPS.map((app) => [app.id, cloneApp(app)]));
  for (const app of list) {
    if (!app || app.deleted || !app.id || merged.has(app.id)) continue;
    merged.set(app.id, cloneApp(app));
  }
  return [...merged.values()];
}

async function loadApps() {
  const apps = await readJson(APPS_FILE, []);
  return Array.isArray(apps) ? apps : [];
}

async function saveApps(list) {
  const dir = dirname(APPS_FILE);
  await ensureDir(dir);
  await writeJsonAtomic(APPS_FILE, list);
}

export async function listApps() {
  await materializeLegacyVideoCutApp();
  return mergeApps(await loadApps());
}

export async function getApp(id) {
  const builtin = getBuiltinApp(id);
  if (builtin) return builtin;
  const apps = await loadApps();
  const existing = apps.find((app) => app.id === id);
  if (existing) return existing.deleted ? null : existing;
  if (normalizeAppId(id) === LEGACY_VIDEO_CUT_APP_ID) {
    return materializeLegacyVideoCutApp();
  }
  return null;
}

export async function getAppByShareToken(shareToken) {
  if (!shareToken) return null;
  const builtin = BUILTIN_APPS.find((app) => app.shareToken === shareToken);
  if (builtin) return cloneApp(builtin);
  const apps = await loadApps();
  const existing = apps.find((app) => app.shareToken === shareToken);
  if (existing) return existing.deleted ? null : existing;
  if (shareToken === LEGACY_VIDEO_CUT_SHARE_TOKEN) {
    return materializeLegacyVideoCutApp({ force: true });
  }
  return null;
}

export async function createApp(input = {}) {
  const {
    name,
    systemPrompt,
    welcomeMessage,
    skills,
    tool,
    templateContext,
  } = input;
  return runAppsMutation(async () => {
    const id = `app_${randomBytes(16).toString('hex')}`;
    const shareToken = `share_${randomBytes(32).toString('hex')}`;
    const app = {
      id,
      name: name || 'Untitled App',
      systemPrompt: systemPrompt || '',
      welcomeMessage: welcomeMessage || '',
      skills: skills || [],
      tool: tool || DEFAULT_APP_TOOL,
      shareToken,
      createdAt: new Date().toISOString(),
    };
    const normalizedTemplateContext = normalizeTemplateContext(templateContext);
    if (normalizedTemplateContext) {
      app.templateContext = normalizedTemplateContext;
    }
    const apps = await loadApps();
    apps.push(app);
    await saveApps(apps);
    return app;
  });
}

export async function updateApp(id, updates) {
  if (isBuiltinAppId(id)) return null;
  return runAppsMutation(async () => {
    const apps = await loadApps();
    const idx = apps.findIndex((app) => app.id === id && !app.deleted);
    if (idx === -1) return null;
    const allowed = ['name', 'systemPrompt', 'welcomeMessage', 'skills', 'tool'];
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        apps[idx][key] = updates[key];
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'templateContext')) {
      const templateContext = normalizeTemplateContext(updates.templateContext);
      if (templateContext) {
        apps[idx].templateContext = templateContext;
      } else {
        delete apps[idx].templateContext;
      }
    }
    apps[idx].updatedAt = new Date().toISOString();
    await saveApps(apps);
    return apps[idx];
  });
}

export async function deleteApp(id) {
  if (isBuiltinAppId(id)) return false;
  return runAppsMutation(async () => {
    const apps = await loadApps();
    const idx = apps.findIndex((app) => app.id === id && !app.deleted);
    if (idx === -1) return false;
    apps[idx].deleted = true;
    apps[idx].deletedAt = new Date().toISOString();
    await saveApps(apps);
    return true;
  });
}
