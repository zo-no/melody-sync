#!/usr/bin/env node
import assert from 'assert/strict';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const compaction = await import(
  pathToFileURL(join(repoRoot, 'backend', 'session-compaction.mjs')).href
);

const {
  buildContextCompactionPrompt,
  buildFallbackCompactionHandoff,
  buildToolActivityIndex,
  parseCompactionWorkerOutput,
  prepareConversationOnlyContinuationBody,
} = compaction;

{
  const parsed = parseCompactionWorkerOutput(
    '<summary>state</summary>\n\n<handoff># Auto Compress</handoff>',
  );
  assert.equal(parsed.summary, 'state');
  assert.equal(parsed.handoff, '# Auto Compress');
}

{
  const handoff = buildFallbackCompactionHandoff('Carry this state forward.', 'tool-a ×2');
  assert.match(handoff, /Carry this state forward\./);
  assert.match(handoff, /Older messages above the marker are no longer loaded/);
  assert.match(handoff, /Earlier tool activity remains in session history/);
}

{
  const prompt = buildContextCompactionPrompt({
    session: { systemPrompt: 'Read AGENTS first.' },
    existingSummary: 'Existing summary',
    conversationBody: '[User]\nNeed next step',
    toolIndex: 'Tools used: exec ×1',
    automatic: true,
  });
  assert.match(prompt, /Compaction trigger: automatic auto-compress/);
  assert.match(prompt, /Parent session instructions:\nRead AGENTS first\./);
  assert.match(prompt, /Previously carried summary:\nExisting summary/);
  assert.match(prompt, /New conversation slice since the last compaction:\n\[User]/);
  assert.match(prompt, /Earlier tool activity index:\nTools used: exec ×1/);
}

{
  const body = prepareConversationOnlyContinuationBody([
    { type: 'message', role: 'user', content: 'Need refactor plan.' },
    { type: 'template_context', templateName: 'brief', content: 'Use the current repository only.' },
    { type: 'status', content: 'error: tool failed' },
    { type: 'status', content: 'queued' },
  ]);
  assert.match(body, /\[User]\nNeed refactor plan\./);
  assert.match(body, /\[Applied template context: brief]/);
  assert.match(body, /\[System status]\nerror: tool failed/);
  assert.doesNotMatch(body, /\nqueued/);
}

{
  const index = buildToolActivityIndex([
    { type: 'tool_use', toolName: 'exec', toolInput: 'npm test' },
    { type: 'tool_use', toolName: 'exec', toolInput: 'git status --short' },
    { type: 'file_change', filePath: 'backend/session-manager.mjs', changeType: 'updated' },
    { type: 'tool_result', toolName: 'exec', exitCode: 1, output: 'failed\ntrace' },
  ]);
  assert.match(index, /Tools used: exec ×2/);
  assert.match(index, /Recent tool calls:/);
  assert.match(index, /Touched files:/);
  assert.match(index, /Notable tool failures:/);
}

console.log('ok');
