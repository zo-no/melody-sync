#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-auto-compact-'));
const tempBin = join(tempHome, 'bin');
const codexSessionsDir = join(tempHome, '.codex', 'sessions', '2026', '03', '10');
const compactionWorkerText = JSON.stringify(
  '<summary>Carry forward only the compacted continuation summary.</summary>\n\n'
  + '<handoff># Auto Compress\n\n'
  + '## Kept in live context\n'
  + '- Carry forward only the compacted continuation summary.\n\n'
  + '## Left out of live context\n'
  + '- Older messages above the marker are no longer in live context.\n\n'
  + '## Continue from here\n'
  + '- Keep going from the fresh handoff.</handoff>'
);

process.env.HOME = tempHome;
process.env.PATH = `${tempBin}:${process.env.PATH}`;
delete process.env.MELODYSYNC_LIVE_CONTEXT_COMPACT_TOKENS;

const config = await import(
  pathToFileURL(join(repoRoot, 'lib', 'config.mjs')).href
);
const configDir = config.CONFIG_DIR;
const hooksFile = config.HOOKS_FILE;
const toolsFile = config.TOOLS_FILE;
const chatHistoryDir = config.CHAT_HISTORY_DIR;

mkdirSync(tempBin, { recursive: true });
mkdirSync(configDir, { recursive: true });
mkdirSync(dirname(hooksFile), { recursive: true });
mkdirSync(codexSessionsDir, { recursive: true });

const fakeCodexPath = join(tempBin, 'fake-codex');
writeFileSync(
  fakeCodexPath,
  `#!/usr/bin/env node
const args = process.argv.slice(2);
const prompt = args[args.length - 1] || '';
const resumeIndex = args.indexOf('resume');
const resumedThreadId = resumeIndex >= 0 ? args[resumeIndex + 1] : '';
const isCompaction = prompt.includes('Please compress this entire session into a continuation summary');

let threadId = resumedThreadId || 'overflow-thread';
if (!isCompaction) {
  if (prompt.includes('exact case')) threadId = 'exact-thread';
  if (prompt.includes('overflow case')) threadId = 'overflow-thread';
}

console.log(JSON.stringify({ type: 'thread.started', thread_id: threadId }));
console.log(JSON.stringify({ type: 'turn.started' }));
console.log(JSON.stringify({
  type: 'item.completed',
  item: {
    type: 'agent_message',
    text: isCompaction
      ? ${compactionWorkerText}
      : 'Finished the requested task.',
  },
}));
console.log(JSON.stringify({
  type: 'turn.completed',
  usage: { input_tokens: 1, output_tokens: 1 },
}));
setTimeout(() => process.exit(0), 50);
`,
  'utf8',
);
chmodSync(fakeCodexPath, 0o755);

writeFileSync(
  hooksFile,
  JSON.stringify({
    enabledById: {
      'builtin.push-notification': false,
      'builtin.memory-writeback': false,
      'builtin.host-completion-voice': false,
      'builtin.email-completion': false,
      'builtin.branch-candidates': false,
      'builtin.session-naming': false,
    },
  }, null, 2),
  'utf8',
);

writeFileSync(
  toolsFile,
  JSON.stringify(
    [
      {
        id: 'fake-codex',
        name: 'Fake Codex',
        command: 'fake-codex',
        runtimeFamily: 'codex-json',
        models: [{ id: 'fake-model', label: 'Fake model' }],
        reasoning: {
          kind: 'enum',
          label: 'Reasoning',
          levels: ['low'],
          default: 'low',
        },
      },
    ],
    null,
    2,
  ),
  'utf8',
);

function writeCodexMetrics(threadId, contextTokens, contextWindowTokens) {
  writeFileSync(
    join(codexSessionsDir, `rollout-2026-03-10T12-17-55-${threadId}.jsonl`),
    `${JSON.stringify({
      timestamp: '2026-03-10T04:18:17.666Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: contextTokens,
            output_tokens: 12,
            total_tokens: contextTokens + 12,
          },
          last_token_usage: {
            input_tokens: contextTokens,
            output_tokens: 12,
            total_tokens: contextTokens + 12,
          },
          model_context_window: contextWindowTokens,
        },
      },
    })}\n`,
    'utf8',
  );
}

writeCodexMetrics('overflow-thread', 101, 100);
writeCodexMetrics('exact-thread', 100, 100);

const hookSettingsStore = await import(
  pathToFileURL(join(repoRoot, 'backend', 'hooks', 'runtime', 'settings-store.mjs')).href
);
await hookSettingsStore.loadPersistedHookSettings();

const sessionManager = await import(
  pathToFileURL(join(repoRoot, 'backend', 'session', 'manager.mjs')).href
);
const history = await import(
  pathToFileURL(join(repoRoot, 'backend', 'history.mjs')).href
);

const {
  createSession,
  getHistory,
  getSession,
  killAll,
  listSessions,
  sendMessage,
} = sessionManager;

const { getContextHead } = history;

function readPersistedContextHead(sessionId) {
  const raw = readFileSync(join(chatHistoryDir, sessionId, 'context.json'), 'utf8');
  return JSON.parse(raw);
}

async function waitFor(predicate, description, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${description}`);
}

try {
  const overflowSession = await createSession(tempHome, 'fake-codex', 'Overflow Fallback', {
    group: 'MelodySync',
    description: 'Verify fallback compaction only after window overflow.',
  });

  await sendMessage(overflowSession.id, 'overflow case', [], {
    tool: 'fake-codex',
    model: 'fake-model',
    effort: 'low',
  });

  await waitFor(
    async () => (await getSession(overflowSession.id))?.contextMode === 'summary',
    'overflow session should auto-compact after exceeding the context window',
  );

  const overflowContextHead = readPersistedContextHead(overflowSession.id);
  assert.equal(
    overflowContextHead?.summary || '',
    '',
    'overflow session should not persist the legacy compaction summary once a handoff is available',
  );
  assert.ok(
    Number.isInteger(overflowContextHead?.handoffSeq) && overflowContextHead.handoffSeq > 0,
    'overflow session should persist the handoff event boundary instead of a summary blob',
  );

  const overflowHistory = await getHistory(overflowSession.id);
  assert.ok(
    overflowHistory.some((event) => event.type === 'status' && /exceeded the model window/.test(event.content || '')),
    'overflow session should record the automatic fallback compaction status',
  );
  assert.ok(
    overflowHistory.some((event) => event.type === 'context_barrier' && /no longer in the model's live context/i.test(event.content || '')),
    'overflow session should insert a visible context barrier after auto-compaction',
  );
  assert.ok(
    overflowHistory.some((event) => event.type === 'message' && event.role === 'assistant' && /# Auto Compress/.test(event.content || '')),
    'overflow session should append a visible auto-compress handoff message',
  );
  assert.ok(
    overflowHistory.some((event) => event.type === 'status' && /Auto Compress finished/.test(event.content || '')),
    'overflow session should record the successful compaction completion status',
  );

  await waitFor(
    async () => (await getSession(overflowSession.id))?.activity?.run?.state === 'idle',
    'overflow session should settle back to idle after compaction',
  );

  const visibleSessionsAfterOverflow = await listSessions({ includeArchived: true });
  assert.equal(
    visibleSessionsAfterOverflow.filter((session) => session.id === overflowSession.id).length,
    1,
    'overflow session should still be listed exactly once after auto-compaction',
  );

  const exactSession = await createSession(tempHome, 'fake-codex', 'Exact Limit', {
    group: 'MelodySync',
    description: 'Verify exact 100% context usage does not auto-compact.',
  });

  await sendMessage(exactSession.id, 'exact case', [], {
    tool: 'fake-codex',
    model: 'fake-model',
    effort: 'low',
  });

  await waitFor(
    async () => (await getSession(exactSession.id))?.activity?.run?.state === 'idle',
    'exact-limit session should finish the main run',
  );
  await new Promise((resolve) => setTimeout(resolve, 250));

  const exactContextHead = await getContextHead(exactSession.id);
  assert.equal(
    exactContextHead,
    null,
    'exact 100% context usage should not trigger fallback auto-compaction',
  );

  const exactHistory = await getHistory(exactSession.id);
  assert.ok(
    !exactHistory.some((event) => event.type === 'status' && /compacting conversation/i.test(event.content || '')),
    'exact 100% context usage should not queue an automatic compaction run',
  );

  console.log('test-auto-compaction: ok');
} finally {
  killAll();
  rmSync(tempHome, { recursive: true, force: true });
}
