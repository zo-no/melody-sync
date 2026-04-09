import { homedir } from 'os';
import { resolve, join } from 'path';
import { createClaudeAdapter, buildClaudeArgs } from '../providers/claude-adapter.mjs';
import { createCodexAdapter, buildCodexArgs } from '../providers/codex-adapter.mjs';
import { getToolDefinitionAsync, getToolCommandAsync, resolveToolCommandPathAsync } from '../../../lib/tools.mjs';
import {
  formatAttachmentContextReference,
  getAttachmentSavedPath,
} from '../../attachment-utils.mjs';
import { pathExists } from '../../fs-utils.mjs';

export function resolveCwd(folder) {
  if (!folder || folder === '~') return homedir();
  if (folder.startsWith('~/')) return join(homedir(), folder.slice(2));
  return resolve(folder);
}

const TAG = '[process-runner]';

/**
 * Resolve a command name to its full absolute path.
 */
export async function resolveCommand(cmd) {
  const resolved = await resolveToolCommandPathAsync(cmd);
  if (resolved && await pathExists(resolved)) {
    console.log(`${TAG} Resolved "${cmd}" → ${resolved}`);
    return resolved;
  }
  console.log(`${TAG} Could not resolve "${cmd}", using bare name`);
  return cmd;
}

function normalizeInvocationArgs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === 'string' || Number.isFinite(entry))
    .map((entry) => String(entry).trim())
    .filter(Boolean);
}

function splitCommandWithArgs(command) {
  const raw = String(command || '').trim();
  if (!raw) {
    return { command: '', commandArgs: [] };
  }
  const tokens = raw.match(/"[^"]*"|'[^']*'|[^\s]+/g) || [];
  if (tokens.length <= 1) {
    return {
      command: raw,
      commandArgs: [],
    };
  }
  return {
    command: tokens[0].replace(/^['"]|['"]$/g, ''),
    commandArgs: tokens
      .slice(1)
      .map((token) => token.replace(/^['"]|['"]$/g, '')),
  };
}

export async function createToolInvocation(toolId, prompt, options = {}) {
  const tool = await getToolDefinitionAsync(toolId);
  const commandSpec = splitCommandWithArgs(tool?.command || await getToolCommandAsync(toolId));
  const command = commandSpec.command;
  const commandArgs = [
    ...normalizeInvocationArgs(commandSpec.commandArgs),
    ...normalizeInvocationArgs(tool?.commandArgs),
  ];
  const runtimeFamily = tool?.runtimeFamily
    || (toolId === 'claude' ? 'claude-stream-json' : toolId === 'codex' ? 'codex-json' : null);
  const isClaudeFamily = runtimeFamily === 'claude-stream-json';
  const isCodexFamily = runtimeFamily === 'codex-json';

  let adapter;
  let args;

  if (isClaudeFamily) {
    adapter = createClaudeAdapter();
    args = [
      ...commandArgs,
      ...buildClaudeArgs(prompt, {
        dangerouslySkipPermissions: options.dangerouslySkipPermissions,
        resume: options.claudeSessionId,
        maxTurns: options.maxTurns,
        continue: options.continue,
        allowedTools: options.allowedTools,
        thinking: options.thinking,
        model: options.model,
      }),
    ];
  } else if (isCodexFamily) {
    adapter = createCodexAdapter();
    args = [
      ...commandArgs,
      ...buildCodexArgs(prompt, {
        threadId: options.codexThreadId,
        model: options.model,
        reasoningEffort: options.effort,
        developerInstructions: options.developerInstructions,
        systemPrefix: options.systemPrefix,
      }),
    ];
  } else {
    adapter = createClaudeAdapter();
    args = [
      ...commandArgs,
      ...buildClaudeArgs(prompt, {
        dangerouslySkipPermissions: options.dangerouslySkipPermissions,
        maxTurns: options.maxTurns,
        continue: options.continue,
        allowedTools: options.allowedTools,
        thinking: options.thinking,
        model: options.model,
      }),
    ];
  }

  return {
    command,
    adapter,
    args,
    isClaudeFamily,
    isCodexFamily,
    runtimeFamily,
  };
}

function describeAttachmentLabel(attachment) {
  const mimeType = typeof attachment?.mimeType === 'string' ? attachment.mimeType : '';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('image/')) return 'image';
  return 'file';
}

export function prependAttachmentPaths(prompt, images) {
  const paths = (images || [])
    .map((img) => ({
      savedPath: getAttachmentSavedPath(img),
      reference: formatAttachmentContextReference(img),
      label: describeAttachmentLabel(img),
    }))
    .filter((entry) => entry.savedPath);
  if (paths.length === 0) return prompt;
  const refs = paths.map((entry) => `[User attached ${entry.label}: ${entry.reference}]`).join('\n');
  return `${refs}\n\n${prompt}`;
}
