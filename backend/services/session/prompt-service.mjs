import { getToolDefinitionAsync } from '../../../lib/tools.mjs';
import { getContextHead, getHistorySnapshot } from '../../history.mjs';
import { buildSourceRuntimePrompt } from '../../source-runtime-prompts.mjs';
import { buildSystemContext } from '../../system-prompt.mjs';
import { loadMemoryActivationPromptContext } from '../../session-prompt/memory-context.mjs';
import { buildPreparedContinuationContext } from '../../session-runtime/session-fork-context.mjs';
import {
  buildTaskCardPromptBlock,
  projectTaskCardFromSessionState,
} from '../../session/task-card.mjs';
import { getOrPrepareForkContext } from './fork-context-service.mjs';

export function resolveResumeState(toolId, session, options = {}) {
  if (options.freshThread === true) {
    return {
      hasResume: false,
      claudeSessionId: null,
      codexThreadId: null,
    };
  }

  const tool = typeof toolId === 'string' ? toolId.trim() : '';
  if (tool === 'claude') {
    const claudeSessionId = session?.claudeSessionId || null;
    return {
      hasResume: !!claudeSessionId,
      claudeSessionId,
      codexThreadId: null,
    };
  }

  if (tool === 'codex') {
    const codexThreadId = session?.codexThreadId || null;
    return {
      hasResume: !!codexThreadId,
      claudeSessionId: null,
      codexThreadId,
    };
  }

  return {
    hasResume: false,
    claudeSessionId: null,
    codexThreadId: null,
  };
}

export function buildPromptSection(title, body) {
  const sectionTitle = typeof title === 'string' ? title.trim() : '';
  const sectionBody = typeof body === 'string' ? body.trim() : '';
  if (!sectionTitle || !sectionBody) return '';
  return `[${sectionTitle}]\n\n${sectionBody}`;
}

/**
 * Inject full GTD API docs when the session is itself a persistent task,
 * or when a persistent task is currently being set up (indicated by the
 * session group matching a known GTD group name).
 */
function resolveIncludeGtdDocs(session) {
  if (!session) return false;
  // Already a persistent task — full API needed to manage it
  if (session.persistent && typeof session.persistent === 'object') return true;
  // Group name signals the user is working in a GTD context
  const group = String(session.group || '').trim().toLowerCase();
  if (['长期任务', '短期任务', '等待任务', 'gtd', 'persistent'].includes(group)) return true;
  return false;
}

/**
 * Inject full session-spawn docs when the session is a persistent task
 * (which may spawn child sessions to execute its work), or when the
 * session group signals an explicit coordination role.
 */
function resolveIncludeDelegationDocs(session) {
  if (!session) return false;
  // Persistent tasks frequently spawn child sessions to execute work
  if (session.persistent && typeof session.persistent === 'object') return true;
  // Explicit coordination role
  const group = String(session.group || '').trim().toLowerCase();
  if (['coordinator', 'orchestrator', '协调', '编排'].includes(group)) return true;
  return false;
}

/**
 * Inject self-hosting dev docs only when the session folder points at the
 * MelodySync source tree, or the session group/name signals dev work.
 */
function resolveIncludeSelfHostingDocs(session) {
  if (!session) return false;
  const folder = String(session.folder || '').toLowerCase();
  if (folder.includes('melody-sync') || folder.includes('melodysync')) return true;
  const group = String(session.group || '').trim().toLowerCase();
  if (['melody-sync', 'melodysync', 'melodysync-dev'].includes(group)) return true;
  return false;
}

export async function buildPrompt(sessionId, session, text, previousTool, effectiveTool, snapshot = null, options = {}) {
  const toolDefinition = await getToolDefinitionAsync(effectiveTool);
  const promptMode = toolDefinition?.promptMode === 'bare-user'
    ? 'bare-user'
    : 'default';
  const flattenPrompt = toolDefinition?.flattenPrompt === true;
  const { hasResume } = resolveResumeState(effectiveTool, session, options);
  const promptTaskCard = promptMode === 'default'
    ? (session?.taskCard || projectTaskCardFromSessionState(session?.sessionState, {
        sessionTitle: session?.name || '',
      }))
    : null;
  const taskCardPromptBlock = promptMode === 'default' && options.internalOperation !== true
    ? buildTaskCardPromptBlock(promptTaskCard, {
        sessionTitle: session?.name || '',
      })
    : '';
  let continuationContext = '';
  let contextToolIndex = '';

  if (!hasResume && options.skipSessionContinuation !== true) {
    const contextHead = await getContextHead(sessionId);
    contextToolIndex = typeof contextHead?.toolIndex === 'string' ? contextHead.toolIndex.trim() : '';
    const prepared = await getOrPrepareForkContext(
      sessionId,
      snapshot || await getHistorySnapshot(sessionId),
      contextHead,
    );
    continuationContext = buildPreparedContinuationContext(
      prepared,
      previousTool,
      effectiveTool,
      session?.sessionState || null,
      {
        includeSessionState: !taskCardPromptBlock,
      },
    );
  }

  let actualText = text;
  if (promptMode === 'default') {
    const turnSections = [];

    if (continuationContext) {
      turnSections.push(buildPromptSection('Session continuity', continuationContext));
    }
    if (contextToolIndex) {
      turnSections.push(buildPromptSection('Earlier tool activity index', contextToolIndex));
    }
    if (typeof options.taskMapRoutingContext === 'string' && options.taskMapRoutingContext.trim()) {
      turnSections.push(buildPromptSection('Task map routing hints', options.taskMapRoutingContext));
    }
    turnSections.push(`Current user message:\n${text}`);
    if (taskCardPromptBlock) {
      turnSections.push(taskCardPromptBlock);
    }

    actualText = turnSections.join('\n\n---\n\n');

    if (!hasResume) {
      const systemContext = await buildSystemContext({
        sessionId,
        includeGtdDocs: resolveIncludeGtdDocs(session),
        includeDelegationDocs: resolveIncludeDelegationDocs(session),
        includeSelfHostingDocs: resolveIncludeSelfHostingDocs(session),
      });
      const preambleSections = [buildPromptSection('Manager context', systemContext)];
      const memoryPromptContext = await loadMemoryActivationPromptContext();
      if (memoryPromptContext.bootstrapMemory) {
        preambleSections.push(buildPromptSection('Bootstrap memory', memoryPromptContext.bootstrapMemory));
      }
      if (memoryPromptContext.profileMemory) {
        preambleSections.push(buildPromptSection('Profile memory', memoryPromptContext.profileMemory));
      }
      if (memoryPromptContext.recentContextDigest) {
        preambleSections.push(buildPromptSection('Recent context digest', memoryPromptContext.recentContextDigest));
      }
      const sourceRuntimePrompt = buildSourceRuntimePrompt(session);
      if (sourceRuntimePrompt) {
        preambleSections.push(buildPromptSection('Source/runtime instructions', sourceRuntimePrompt));
      }
      if (session.systemPrompt) {
        preambleSections.push(buildPromptSection('App instructions', session.systemPrompt));
      }
      actualText = [...preambleSections, actualText].filter(Boolean).join('\n\n---\n\n');
    }
  } else if (flattenPrompt) {
    actualText = actualText.replace(/\s+/g, ' ').trim();
  }

  if (flattenPrompt && promptMode === 'default') {
    actualText = actualText.replace(/\s+/g, ' ').trim();
  }

  return actualText;
}
