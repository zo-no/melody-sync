#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const realtimeSource = readFileSync(join(repoRoot, 'frontend-src', 'core', 'realtime-render.js'), 'utf8');
const uiSource = readFileSync(join(repoRoot, 'frontend-src', 'session', 'transcript-ui.js'), 'utf8');

assert.match(uiSource, /应用建议/, 'assistant transcript UI should expose an explicit click-to-apply suggestion label for graph ops proposals');
assert.match(uiSource, /graph-ops\/apply/, 'assistant transcript UI should post graph ops proposals to the explicit apply route instead of auto-applying them');

function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const paramsStart = source.indexOf('(', start);
  assert.notEqual(paramsStart, -1, `${functionName} should have parameters`);
  let paramsDepth = 0;
  let braceStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        braceStart = source.indexOf('{', index);
        break;
      }
    }
  }
  assert.notEqual(braceStart, -1, `${functionName} should have a body`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

const cleanBase64TextForDisplaySource = extractFunctionSource(realtimeSource, 'cleanBase64TextForDisplay');
const looksLikeReadableDisplayTextSource = extractFunctionSource(realtimeSource, 'looksLikeReadableDisplayText');
const tryDecodeUtf8Base64TextSource = extractFunctionSource(realtimeSource, 'tryDecodeUtf8Base64Text');
const formatDecodedDisplayTextSource = extractFunctionSource(realtimeSource, 'formatDecodedDisplayText');
const extractHiddenDisplayBlocksSource = extractFunctionSource(uiSource, 'extractHiddenDisplayBlocks');
const renderMarkdownIntoNodeSource = extractFunctionSource(uiSource, 'renderMarkdownIntoNode');
const resolveLiveTaskCardPreviewSource = extractFunctionSource(uiSource, 'resolveLiveTaskCardPreview');
const notifyLiveTaskCardPreviewSource = extractFunctionSource(uiSource, 'notifyLiveTaskCardPreview');

const parsedInputs = [];
const liveTaskCardPreviewCalls = [];
const context = {
  console,
  marked: {
    parse(text) {
      parsedInputs.push(text);
      return `<p>${text}</p>`;
    },
  },
  enhanceCodeBlocks() {},
  enhanceRenderedContentLinks() {},
  currentSessionId: 'session-live',
  window: {
    MelodySyncWorkbench: {
      setLiveTaskCardPreview(taskCard, options) {
        liveTaskCardPreviewCalls.push({ taskCard, options });
        return true;
      },
    },
  },
};
context.globalThis = context;
context.window.window = context.window;

vm.runInNewContext(
  [
    cleanBase64TextForDisplaySource,
    looksLikeReadableDisplayTextSource,
    tryDecodeUtf8Base64TextSource,
    formatDecodedDisplayTextSource,
    extractHiddenDisplayBlocksSource,
    renderMarkdownIntoNodeSource,
    resolveLiveTaskCardPreviewSource,
    notifyLiveTaskCardPreviewSource,
    'globalThis.formatDecodedDisplayText = formatDecodedDisplayText;',
    'globalThis.extractHiddenDisplayBlocks = extractHiddenDisplayBlocks;',
    'globalThis.renderMarkdownIntoNode = renderMarkdownIntoNode;',
    'globalThis.resolveLiveTaskCardPreview = resolveLiveTaskCardPreview;',
    'globalThis.notifyLiveTaskCardPreview = notifyLiveTaskCardPreview;',
  ].join('\n\n'),
  context,
  { filename: 'frontend-src/session/transcript-ui.js' },
);

const assistantContent = 'Visible text\nTail\n<private><task_card>{"goal":"排查","checkpoint":"继续"}</task_card></private>';
const extracted = context.extractHiddenDisplayBlocks(assistantContent);
assert.equal(
  extracted.visibleContent,
  'Visible text\nTail\n',
  'assistant sidecar extraction should keep only visible prose in the rendered body',
);
assert.equal(extracted.hiddenBlocks.length, 1, 'assistant sidecar extraction should capture hidden blocks');
assert.equal(extracted.hiddenBlocks[0].kind, 'task_card', 'task_card sidecars should be classified explicitly');
assert.match(
  extracted.hiddenBlocks[0].formattedContent,
  /"goal": "排查"/,
  'task_card sidecars should be formatted as readable JSON in the folded panel',
);

const graphOpsContent = 'Visible text\n<private><graph_ops>{"operations":[{"type":"archive","source":"重复任务"}]}</graph_ops></private>';
const extractedGraphOps = context.extractHiddenDisplayBlocks(graphOpsContent);
assert.equal(extractedGraphOps.hiddenBlocks[0].kind, 'graph_ops', 'graph_ops sidecars should be classified explicitly');
assert.match(
  extractedGraphOps.hiddenBlocks[0].formattedContent,
  /"type": "archive"/,
  'graph_ops sidecars should be formatted as readable JSON in the folded panel',
);

const inlineLiteralContent = [
  '现在会话页里：',
  '- `<private>/<hide>` 会被识别成单独的折叠块',
  '- `task_card` 会作为“隐藏任务卡”折叠显示',
  '<private><task_card>{"summary":"折叠sidecar"}</task_card></private>',
].join('\n');
const extractedInlineLiteral = context.extractHiddenDisplayBlocks(inlineLiteralContent);
assert.match(
  extractedInlineLiteral.visibleContent,
  /`<private>\/<hide>` 会被识别成单独的折叠块/,
  'literal <hide> text inside the visible prose should not be swallowed into the hidden sidecar panel',
);
assert.equal(
  extractedInlineLiteral.hiddenBlocks.length,
  1,
  'only the trailing hidden sidecar should be extracted when visible prose mentions literal hidden tags',
);

const standaloneHiddenContent = [
  'Visible intro',
  '<hide>step 1\nstep 2</hide>',
  'Visible outro',
].join('\n');
const extractedStandalone = context.extractHiddenDisplayBlocks(standaloneHiddenContent);
assert.equal(
  extractedStandalone.visibleContent,
  'Visible intro\n\nVisible outro',
  'standalone hidden blocks should still be surfaced separately while keeping the visible prose intact',
);
assert.equal(
  extractedStandalone.hiddenBlocks[0].content,
  'step 1\nstep 2',
  'standalone hidden blocks should be preserved as folded hidden content',
);

const node = { innerHTML: '', textContent: '' };
assert.equal(
  context.renderMarkdownIntoNode(node, 'Hello\n<hide>secret</hide>\nworld'),
  true,
  'generic markdown rendering should still succeed for raw content strings',
);
assert.equal(
  parsedInputs[0],
  'Hello\n<hide>secret</hide>\nworld',
  'generic markdown rendering should preserve raw hidden blocks unless the assistant render path splits them first',
);

const livePreviewTaskCard = context.resolveLiveTaskCardPreview([
  {
    kind: 'task_card',
    content: '{"summary":"修任务卡","checkpoint":"让运行中页面也读取最新 task_card 进度"}',
  },
]);
assert.equal(livePreviewTaskCard?.summary, '修任务卡');
assert.equal(livePreviewTaskCard?.checkpoint, '让运行中页面也读取最新 task_card 进度');

assert.equal(
  context.notifyLiveTaskCardPreview([
    {
      kind: 'task_card',
      content: '{"summary":"修任务卡","checkpoint":"让运行中页面也读取最新 task_card 进度"}',
    },
  ], {
    seq: 42,
  }),
  true,
  'hidden task_card sidecars should be forwarded to the live workbench preview when available',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(liveTaskCardPreviewCalls)),
  [
    {
      taskCard: {
        summary: '修任务卡',
        checkpoint: '让运行中页面也读取最新 task_card 进度',
      },
      options: {
        sessionId: 'session-live',
        sourceSeq: 42,
      },
    },
  ],
  'live task-card preview forwarding should preserve the parsed payload and current session context',
);

console.log('test-chat-hidden-display-blocks: ok');
