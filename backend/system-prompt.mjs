import { homedir } from 'os';
import { readFile } from 'fs/promises';
import { CHAT_PORT, MELODYSYNC_AGENTS_FILE, MEMORY_DIR, SYSTEM_MEMORY_DIR } from '../lib/config.mjs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pathExists } from './fs-utils.mjs';
import { MANAGER_RUNTIME_BOUNDARY_SECTION } from './runtime-policy.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, 'prompts');

const BOOTSTRAP_MD = join(MEMORY_DIR, 'bootstrap.md');
const GLOBAL_MD = join(MEMORY_DIR, 'global.md');
const PROJECTS_MD = join(MEMORY_DIR, 'projects.md');
const SKILLS_MD = join(MEMORY_DIR, 'skills.md');
const MEMORY_README = join(MEMORY_DIR, 'README.md');
const AGENT_PROFILE_MD = join(MEMORY_DIR, 'agent-profile.md');
const CONTEXT_DIGEST_MD = join(MEMORY_DIR, 'context-digest.md');
const TASKS_DIR = join(MEMORY_DIR, 'tasks');
const WORKLOG_DIR = join(MEMORY_DIR, 'worklog');
const SYSTEM_MEMORY_FILE = join(SYSTEM_MEMORY_DIR, 'system.md');

function displayPath(targetPath, home) {
  const normalizedTarget = typeof targetPath === 'string' ? targetPath.trim() : '';
  const normalizedHome = typeof home === 'string' ? home.trim() : '';
  if (!normalizedTarget) return '';
  if (normalizedHome && normalizedTarget === normalizedHome) return '~';
  if (normalizedHome && normalizedTarget.startsWith(`${normalizedHome}/`)) {
    return `~${normalizedTarget.slice(normalizedHome.length)}`;
  }
  return normalizedTarget;
}

/**
 * Load a prompt file from backend/prompts/ and replace {{VARIABLE}} placeholders.
 */
async function loadPrompt(relPath, vars = {}) {
  try {
    let content = await readFile(join(PROMPTS_DIR, relPath), 'utf8');
    for (const [key, value] of Object.entries(vars)) {
      content = content.replaceAll(`{{${key}}}`, value);
    }
    return content.trim();
  } catch {
    return '';
  }
}

/**
 * Build the system context to prepend to the first message of a session.
 * Prompts are loaded from backend/prompts/ — edit those files to change AI behavior.
 */
export async function buildSystemContext(options = {}) {
  const home = homedir();
  const bootstrapPath = displayPath(BOOTSTRAP_MD, home);
  const globalPath = displayPath(GLOBAL_MD, home);
  const projectsPath = displayPath(PROJECTS_MD, home);
  const skillsPath = displayPath(SKILLS_MD, home);
  const memoryReadmePath = displayPath(MEMORY_README, home);
  const agentProfilePath = displayPath(AGENT_PROFILE_MD, home);
  const contextDigestPath = displayPath(CONTEXT_DIGEST_MD, home);
  const tasksPath = displayPath(TASKS_DIR, home);
  const worklogPath = displayPath(WORKLOG_DIR, home);
  const agentsFilePath = displayPath(MELODYSYNC_AGENTS_FILE, home);
  const memoryDirPath = displayPath(MEMORY_DIR, home);
  const systemMemoryDirPath = displayPath(SYSTEM_MEMORY_DIR, home);
  const systemMemoryFilePath = displayPath(SYSTEM_MEMORY_FILE, home);
  const currentSessionId = typeof options?.sessionId === 'string' ? options.sessionId.trim() : '';

  const [hasBootstrap, hasGlobal, hasProjects, hasSkills, hasAgentsFile, hasMemoryReadme, hasAgentProfile, hasContextDigest] = await Promise.all([
    pathExists(BOOTSTRAP_MD),
    pathExists(GLOBAL_MD),
    pathExists(PROJECTS_MD),
    pathExists(SKILLS_MD),
    pathExists(MELODYSYNC_AGENTS_FILE),
    pathExists(MEMORY_README),
    pathExists(AGENT_PROFILE_MD),
    pathExists(CONTEXT_DIGEST_MD),
  ]);
  const isFirstTime = !hasBootstrap && !hasGlobal;

  // Shared variable map for prompt file substitution
  const vars = {
    CHAT_PORT: String(CHAT_PORT),
    BOOTSTRAP: bootstrapPath,
    GLOBAL: globalPath,
    PROJECTS: projectsPath,
    SKILLS: skillsPath,
    MEMORY_README: memoryReadmePath,
    AGENT_PROFILE: agentProfilePath,
    CONTEXT_DIGEST: contextDigestPath,
    TASKS_DIR: tasksPath,
    WORKLOG_DIR: worklogPath,
    AGENTS_FILE: agentsFilePath,
    MEMORY_DIR: memoryDirPath,
    SYSTEM_MEMORY_DIR: systemMemoryDirPath,
    SYSTEM_MEMORY_FILE: systemMemoryFilePath,
    SESSION_ID: currentSessionId,
  };

  // ── Core layer (always injected) ──────────────────────────────────
  const [constitutionPrompt, memoryPrompt, sessionRoutingPrompt] = await Promise.all([
    loadPrompt('core/constitution.md', vars),
    loadPrompt('core/memory-system.md', vars),
    loadPrompt('core/session-routing.md', vars),
  ]);

  let context = `You are an AI agent operating on this computer via MelodySync. The user may be controlling this machine from phone or desktop. You have full access to this machine. This manager context is operational scaffolding for you, not a template for user-facing phrasing, so do not mirror its headings, bullets, or checklist structure back to the user unless they explicitly ask for that format.

## Seed Layer — Editable Default Constitution

MelodySync ships a small startup scaffold: core collaboration principles, memory assembly rules, and capability hints. Treat this as an editable seed layer, not permanent law. As the user and agent build a stronger working relationship, this layer may be refined, replaced, or pruned into a more personal system.

${memoryPrompt}

${MANAGER_RUNTIME_BOUNDARY_SECTION}

${sessionRoutingPrompt}

${constitutionPrompt}`;

  // ── Conditional: missing memory files ────────────────────────────
  if (!hasBootstrap && hasGlobal) {
    context += `

## Legacy Memory Layout Detected
This machine has ${globalPath} but no ${bootstrapPath} yet.
- Do NOT treat global.md as mandatory startup context for every conversation.
- At a natural breakpoint, backfill bootstrap.md with only the small startup index.
- Create projects.md when recurring repos or task families need a lightweight pointer catalog.`;
  }

  if (!hasAgentsFile) {
    context += `

## MelodySync Agent Guide Missing
If this machine uses a dedicated MelodySync local data root, create ${agentsFilePath} as the user-editable boundary file that tells the agent which MelodySync files to read by default and, when needed, how the broader local workspace should be managed.`;
  }

  if (!hasProjects && (hasBootstrap || hasGlobal)) {
    context += `

## Project Pointer Catalog Missing
If this machine has recurring repos or task families, create ${projectsPath} as a small routing layer instead of stuffing those pointers into startup context.`;
  }

  if (!hasSkills) {
    context += `

## Skills Index Missing
If local reusable workflows exist, create ${skillsPath} as a minimal placeholder index instead of treating the absence as a hard failure.`;
  }

  if (!hasMemoryReadme) {
    context += `

## Memory Map Missing
If this machine relies on a durable Obsidian-backed memory tree, create ${memoryReadmePath} as the file-ownership map so future writebacks know where stable preferences, recent digests, task notes, and work logs belong.`;
  }

  if (!hasAgentProfile) {
    context += `

## Agent Profile Missing
If long-term user preferences and collaboration defaults are already known, capture them in ${agentProfilePath} instead of bloating bootstrap.md or global.md.`;
  }

  if (!hasContextDigest) {
    context += `

## Context Digest Missing
If this machine keeps recent durable context in Obsidian, create ${contextDigestPath} as a lightweight rolling digest instead of stuffing recency into bootstrap.md.`;
  }

  if (isFirstTime) {
    context += `

## FIRST-TIME SETUP REQUIRED
This machine is missing both bootstrap.md and global.md. Before diving into detailed work:
1. Explore the home directory (${home}) briefly to map key repos and working areas.
2. Create ${memoryReadmePath} as the memory layout map for this Obsidian-backed long-term memory tree.
3. Create ${agentProfilePath} for stable user preferences and collaboration defaults.
4. Create ${contextDigestPath} for lightweight recent durable context.
5. Create ${bootstrapPath} with machine basics, collaboration defaults, key directories, and short project pointers.
6. Create ${projectsPath} if there are recurring repos or task families worth indexing.
7. Create ${globalPath} only for deeper local notes that should NOT be startup context.
8. Create ${skillsPath} if local reusable workflows exist.
9. Show the user a brief bootstrap summary and confirm it is correct.

Bootstrap only needs to be tiny. Stable preferences belong in agent-profile.md, recent durable context belongs in context-digest.md, and detailed memory belongs in projects.md, tasks/, worklog/, or global.md.`;
  }

  // ── GTD layer (conditional) ───────────────────────────────────────
  if (options?.includeGtdDocs) {
    const [taskTypesPrompt, taskLifecyclePrompt, taskApiPrompt, pipelinePrompt] = await Promise.all([
      loadPrompt('gtd/task-types.md', vars),
      loadPrompt('gtd/task-lifecycle.md', vars),
      loadPrompt('gtd/task-api.md', vars),
      loadPrompt('gtd/pipeline-pattern.md', vars),
    ]);

    context += `

${taskTypesPrompt}

${taskLifecyclePrompt}

${taskApiPrompt}

${pipelinePrompt}`;
  }

  // ── Delegation layer (conditional) ───────────────────────────────
  if (options?.includeDelegationDocs) {
    const spawnPrompt = await loadPrompt('delegation/spawn-reference.md', vars);
    if (spawnPrompt) {
      context += `

## Session Spawn Reference

${spawnPrompt}`;
    }
  }

  // ── Dev layer (conditional) ───────────────────────────────────────
  if (options?.includeSelfHostingDocs) {
    const devPrompt = await loadPrompt('dev/self-hosting.md', vars);
    if (devPrompt) {
      context += `

${devPrompt}`;
    }
  }

  return context;
}
