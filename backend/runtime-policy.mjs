import { copyFile, lstat, readFile, readlink, symlink, unlink } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { CODEX_MANAGED_HOME_DIR } from '../lib/config.mjs';
import {
  createSerialTaskQueue,
  ensureDir,
  pathExists,
  writeTextAtomic,
} from './fs-utils.mjs';

export const MANAGER_RUNTIME_BOUNDARY_SECTION = [
  '## Manager Policy Boundary',
  '',
  'MelodySync owns memory activation, workflow policy, and default reply style.',
  'Treat provider runtimes such as Codex or Claude as execution engines under manager control, not as the top-level manager.',
  'Use the prompt stack to synchronize principles, boundaries, and default assembly rules, not to script every action as a hidden SOP.',
  'Treat MelodySync\'s startup guidance as an editable seed layer: a default constitution and capability scaffold that users may later refine, replace, or prune as their own workflow matures.',
  'Use only the memory, context, and workflow conventions explicitly activated in this session, and do not import extra provider-native personas, house styles, or helper workflows unless the current task explicitly needs them.',
  'For normal conversation and conceptual discussion, default to natural connected prose. Use headings, bullet lists, JSON, or checklists only when the user explicitly asks for them or when clarity truly requires them.',
  'For summaries and handoffs, default to state-first reorientation: current execution state, whether the user is needed now, or whether the work can stay parked for later.',
  'Before stopping to ask the user for clarification, first try current context, local inspection, memory, or a safe reversible default.',
  'Only stop when the missing piece truly belongs to the user: unique external information, a user-owned decision, explicit authorization for an irreversible action, or manual verification only the user can perform.',
  'Do not send user-facing progress reports just because work is underway. Keep executing until you finish a meaningful chunk or genuinely need user input to continue.',
].join('\n');

export const MANAGER_TURN_POLICY_REMINDER = [
  'MelodySync remains the manager for this turn.',
  'Keep the hidden prompt light: reinforce invariants and current state, not verbose step-by-step scripts.',
  'Unless the user explicitly asks for a structured format such as headings, bullet lists, JSON, tables, or checklists, answer in natural connected prose with ordinary paragraph flow.',
  'Do not mirror the manager prompt structure or provider-native report formatting back to the user by default.',
  'In summaries or handoffs, lead with the current execution state, then whether the user is needed now or the work can stay parked for later.',
  'Try context, inspection, memory, and safe defaults before asking the user to fill a gap.',
  'Do not stop to send progress-only updates while meaningful execution can continue; only surface a reply when a meaningful chunk is complete or the user is actually needed.',
].join(' ');

export const DEFAULT_CODEX_DEVELOPER_INSTRUCTIONS = [
  'You are running inside MelodySync.',
  'MelodySync owns the higher-level workflow, memory policy, and reply style.',
  'Treat Codex as a runtime under manager control, not as the top-level product persona.',
  'Do not impose a strong built-in persona, house style, or product-specific workflow beyond the context explicitly provided for this task.',
  'Treat the startup prompt as an editable seed layer rather than rigid law; users may refine or replace it over time.',
  'Use prompt guidance to preserve principles and boundaries, not to offload judgment that should come from the current task context.',
  'Use only the memory, context, and workflow conventions explicitly activated in this session.',
  'For normal user-facing replies, default to plain connected prose rather than report formatting.',
  'Do not use headings, bullet lists, or checklist formatting unless the user explicitly asks for them or the task truly cannot be answered clearly without them.',
  'Do not mirror the manager prompt structure, section headers, or provider-native handoff template back to the user by default.',
  'For short explanations, conceptual discussion, and back-and-forth conversation, answer in natural paragraphs instead of list form.',
  'For summaries and handoffs, lead with current execution state, then whether the user is needed now or the work can stay parked for later.',
  'Try current context, local inspection, memory, and safe reversible defaults before asking the user to fill a gap.',
  'Only stop when you truly need user-owned information, a user-owned decision, explicit authorization for an irreversible action, or manual verification that only the user can provide.',
  'Do not send progress-only user-facing updates while you can continue working.',
  'Keep executing until you either finish a meaningful chunk or truly need user input, approval, credentials, a choice, or manual verification that only the user can provide.',
  'If the task explicitly asks for structured output, code, JSON, tables, checklists, or another format, follow that format exactly.',
  'Treat unstated preferences as open and adaptable; let the user and session context shape tone and working style over time.',
].join(' ');

const DEFAULT_CODEX_HOME_MODE = 'managed';
const MANAGED_CODEX_HOME_NOTES = [
  '# MelodySync-managed Codex runtime home.',
  '# Keep this intentionally minimal.',
  '# MelodySync injects workflow, memory policy, and reply-style steering per run.',
  '',
].join('\n');

const PERSONAL_CODEX_HOME = join(homedir(), '.codex');
const PERSONAL_CODEX_AUTH_FILE = join(PERSONAL_CODEX_HOME, 'auth.json');
const PERSONAL_CODEX_CONFIG_FILE = join(PERSONAL_CODEX_HOME, 'config.toml');
const managedCodexHomeQueue = createSerialTaskQueue();

function normalizeCodexHomeMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'personal' || normalized === 'inherit') {
    return 'personal';
  }
  return DEFAULT_CODEX_HOME_MODE;
}

async function ensureSymlinkOrCopy(sourcePath, targetPath) {
  if (!await pathExists(sourcePath)) {
    return false;
  }

  try {
    const existing = await lstat(targetPath);
    if (existing.isSymbolicLink()) {
      const currentTarget = await readlink(targetPath);
      if (currentTarget === sourcePath) {
        return true;
      }
    }
    await unlink(targetPath);
  } catch {
  }

  try {
    await symlink(sourcePath, targetPath);
    return true;
  } catch {
  }

  try {
    await copyFile(sourcePath, targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeTomlSectionHeader(line) {
  const match = String(line || '').trim().match(/^\[([^\]]+)\]$/);
  return match ? match[1].trim() : '';
}

function isModelProviderSection(sectionName) {
  return sectionName === 'model_providers' || sectionName.startsWith('model_providers.');
}

function extractRootModelProviderLine(lines) {
  for (const line of lines) {
    if (normalizeTomlSectionHeader(line)) break;
    if (/^\s*model_provider\s*=/.test(line)) return `${line.trim()}\n`;
  }
  return '';
}

function extractModelProviderSections(lines) {
  const sections = [];
  let current = null;

  for (const line of lines) {
    const sectionName = normalizeTomlSectionHeader(line);
    if (sectionName) {
      if (current) sections.push(current);
      current = isModelProviderSection(sectionName) ? [line] : null;
      continue;
    }
    if (current) {
      current.push(line);
    }
  }
  if (current) sections.push(current);

  return sections
    .map((section) => section.join('\n').trim())
    .filter(Boolean)
    .join('\n\n');
}

async function buildManagedCodexConfig(configSource) {
  const sourcePath = typeof configSource === 'string' && configSource.trim()
    ? configSource.trim()
    : PERSONAL_CODEX_CONFIG_FILE;
  let personalConfig = '';
  try {
    personalConfig = await readFile(sourcePath, 'utf8');
  } catch {
  }

  const lines = personalConfig.split(/\r?\n/);
  const providerLine = extractRootModelProviderLine(lines);
  const providerSections = extractModelProviderSections(lines);
  const inheritedConfig = [providerLine.trim(), providerSections.trim()].filter(Boolean).join('\n\n');
  if (!inheritedConfig) {
    return MANAGED_CODEX_HOME_NOTES;
  }

  return [
    MANAGED_CODEX_HOME_NOTES.trimEnd(),
    '',
    '# Inherited from the owner Codex config: provider routing only.',
    '# MelodySync intentionally does not copy personal project trust, MCP servers, or UI settings.',
    inheritedConfig,
    '',
  ].join('\n');
}

export async function ensureManagedCodexHome(options = {}) {
  return managedCodexHomeQueue(async () => {
    const homeDir = typeof options.homeDir === 'string' && options.homeDir.trim()
      ? options.homeDir.trim()
      : CODEX_MANAGED_HOME_DIR;
    const authSource = typeof options.authSource === 'string' && options.authSource.trim()
      ? options.authSource.trim()
      : PERSONAL_CODEX_AUTH_FILE;
    const configSource = typeof options.configSource === 'string' && options.configSource.trim()
      ? options.configSource.trim()
      : PERSONAL_CODEX_CONFIG_FILE;

    await ensureDir(homeDir);
    await writeTextAtomic(join(homeDir, 'config.toml'), await buildManagedCodexConfig(configSource));
    await writeTextAtomic(join(homeDir, 'AGENTS.md'), '');
    await ensureSymlinkOrCopy(authSource, join(homeDir, 'auth.json'));
    return homeDir;
  });
}

export async function applyManagedRuntimeEnv(toolId, baseEnv = {}, options = {}) {
  const env = { ...baseEnv };
  const runtimeFamily = typeof options.runtimeFamily === 'string'
    ? options.runtimeFamily.trim()
    : '';
  const isCodexRuntime = toolId === 'codex' || runtimeFamily === 'codex-json';
  if (!isCodexRuntime) {
    return env;
  }

  const mode = normalizeCodexHomeMode(options.codexHomeMode || process.env.MELODYSYNC_CODEX_HOME_MODE);
  if (mode === 'personal') {
    return env;
  }

  const managedHome = await ensureManagedCodexHome({
    homeDir: options.codexHomeDir,
    authSource: options.codexAuthSource,
    configSource: options.codexConfigSource,
  });
  delete env.CODEX_HOME;
  env.CODEX_HOME = managedHome;
  return env;
}
