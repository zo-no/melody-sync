import { getToolDefinitionAsync } from '../../../lib/tools.mjs';
import { getContextHead, getHistorySnapshot } from '../../history.mjs';
import { buildSourceRuntimePrompt } from '../../source-runtime-prompts.mjs';
import { buildSystemContext } from '../../system-prompt.mjs';
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

export async function buildPrompt(sessionId, session, text, previousTool, effectiveTool, snapshot = null, options = {}) {
  const toolDefinition = await getToolDefinitionAsync(effectiveTool);
  const promptMode = toolDefinition?.promptMode === 'bare-user'
    ? 'bare-user'
    : 'default';
  const flattenPrompt = toolDefinition?.flattenPrompt === true;
  const { hasResume } = resolveResumeState(effectiveTool, session, options);
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
    continuationContext = buildPreparedContinuationContext(prepared, previousTool, effectiveTool, session?.sessionState || null);
  }

  let actualText = text;
  if (promptMode === 'default') {
    const turnSections = [];
    const promptTaskCard = session?.taskCard || projectTaskCardFromSessionState(session?.sessionState, {
      sessionTitle: session?.name || '',
    });
    const taskCardPromptBlock = options.internalOperation
      ? ''
      : buildTaskCardPromptBlock(promptTaskCard, {
          sessionTitle: session?.name || '',
        });

    if (continuationContext) {
      turnSections.push(buildPromptSection('Session continuity', continuationContext));
    }
    if (contextToolIndex) {
      turnSections.push(buildPromptSection('Earlier tool activity index', contextToolIndex));
    }
    turnSections.push(`Current user message:\n${text}`);
    if (taskCardPromptBlock) {
      turnSections.push(taskCardPromptBlock);
    }

    actualText = turnSections.join('\n\n---\n\n');

    if (!hasResume) {
      const systemContext = await buildSystemContext({ sessionId });
      const preambleSections = [buildPromptSection('Manager context', systemContext)];
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
