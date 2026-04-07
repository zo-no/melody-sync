#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-welcome-task-card-'));
const tempBin = join(tempHome, 'bin');
const configDir = join(tempHome, '.config', 'melody-sync');

mkdirSync(tempBin, { recursive: true });
mkdirSync(configDir, { recursive: true });

const fakeCodexPath = join(tempBin, 'fake-codex');
writeFileSync(
  fakeCodexPath,
  `#!/usr/bin/env node
const prompt = process.argv[process.argv.length - 1] || '';
const text = [
  '我先开始整理材料，并把第一版任务卡沉淀下来。',
  '<task_card>{',
  '  "mode": "project",',
  '  "summary": "先整理用户丢来的 Excel 和 PPT，再形成第一版可复用流程。",',
  '  "goal": "接管周报整理流程。",',
  '  "rawMaterials": ["sales.xlsx", "brief.pptx"],',
  '  "background": ["用户目前靠手工处理。"],',
  '  "knownConclusions": ["原始材料比口头描述更关键。"],',
  '  "nextSteps": ["检查 Excel 结构", "整理第一版摘要"],',
  '  "memory": ["用户不想先写长说明。"],',
  '  "candidateBranches": ["沉淀周报模板"],',
  '  "needsFromUser": ["若字段含义不清，再补一个目标样例。"]',
  '}</task_card>',
].join(String.fromCharCode(10));

console.log(JSON.stringify({ type: 'thread.started', thread_id: 'run-thread' }));
console.log(JSON.stringify({ type: 'turn.started' }));
console.log(JSON.stringify({
  type: 'item.completed',
  item: { type: 'agent_message', text },
}));
console.log(JSON.stringify({
  type: 'turn.completed',
  usage: { input_tokens: 1, output_tokens: 1 },
}));
process.exit(0);
`,
  'utf8',
);
chmodSync(fakeCodexPath, 0o755);

writeFileSync(
  join(configDir, 'tools.json'),
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

process.env.HOME = tempHome;
process.env.PATH = `${tempBin}:${process.env.PATH}`;

const sessionManager = await import(pathToFileURL(join(repoRoot, 'backend', 'session-manager.mjs')).href);
const {
  createSession,
  getHistory,
  getSession,
  sendMessage,
  killAll,
} = sessionManager;

async function waitFor(predicate, description, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${description}`);
}

const session = await createSession(tempHome, 'fake-codex', 'Welcome Intake', {
  sourceId: 'chat',
  sourceName: 'Chat',
  group: 'MelodySync',
  description: 'Intake state should keep a visible structured task card.',
});

await sendMessage(session.id, '我有两个原始文件，想把周报整理这件事交给你。', [], {
  tool: 'fake-codex',
  model: 'fake-model',
  effort: 'low',
});

await waitFor(
  async () => (await getSession(session.id))?.activity?.run?.state === 'idle',
  'session should finish running',
);

await waitFor(
  async () => (await getSession(session.id))?.taskCard?.summary === '先整理用户丢来的 Excel 和 PPT，再形成第一版可复用流程。',
  'welcome session should persist the explicit task card',
);

const updated = await getSession(session.id);
assert.equal(updated?.taskCard?.mode, 'project');
assert.equal(updated?.taskCard?.goal, updated?.name, 'mainline task cards should stay anchored to the fixed session task title');
assert.equal(updated?.taskCard?.mainGoal, updated?.name, 'mainline task cards should keep the main goal aligned with the session title');
assert.deepEqual(updated?.taskCard?.rawMaterials, ['sales.xlsx', 'brief.pptx']);
assert.deepEqual(updated?.taskCard?.nextSteps, ['检查 Excel 结构', '整理第一版摘要']);
assert.deepEqual(updated?.taskCard?.memory, ['用户不想先写长说明。']);
assert.deepEqual(updated?.taskCard?.candidateBranches, ['沉淀周报模板']);

const history = await getHistory(session.id);
const assistantReply = history.find((event) => event.type === 'message' && event.role === 'assistant');
assert.ok(assistantReply?.content?.includes('我先开始整理材料'));
assert.equal(
  assistantReply?.content?.includes('<task_card>'),
  false,
  'persisted assistant messages should strip the explicit task-card markup from visible prose history',
);
assert.equal(
  assistantReply?.content?.includes('"candidateBranches"'),
  false,
  'persisted assistant messages should strip the trailing task-card JSON from visible prose history',
);
assert.equal(
  history.some((event) => event.type === 'status' && event.statusKind === 'branch_candidate' && event.branchTitle === '沉淀周报模板'),
  true,
  'new candidate branches should also surface as explicit branch recommendation actions in the visible conversation flow',
);

killAll();
rmSync(tempHome, { recursive: true, force: true });

console.log('test-session-welcome-task-card: ok');
