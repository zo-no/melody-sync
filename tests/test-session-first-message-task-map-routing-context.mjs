#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-task-map-routing-'));
const tempBin = join(tempHome, 'bin');
const configDir = join(tempHome, '.config', 'melody-sync');
const promptLogPath = join(tempHome, 'prompt.log');

mkdirSync(tempBin, { recursive: true });
mkdirSync(configDir, { recursive: true });
writeFileSync(promptLogPath, '', 'utf8');

const fakeCodexPath = join(tempBin, 'fake-codex');
writeFileSync(
  fakeCodexPath,
  `#!/usr/bin/env node
const fs = require('fs');
const prompt = process.argv[process.argv.length - 1] || '';
if (process.env.PROMPT_LOG_FILE) {
  fs.appendFileSync(process.env.PROMPT_LOG_FILE, prompt + '\\n---PROMPT---\\n', 'utf8');
}
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'task-map-routing-thread' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  console.log(JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'agent_message',
      text: 'Done.\\n<private><graph_ops>{"operations":[{"type":"attach","source":"current","target":"PM Loop / PMA","reason":"归入长期项目地图"}]}</graph_ops></private>',
    },
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
}, 40);
setTimeout(() => process.exit(0), 70);
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
process.env.PROMPT_LOG_FILE = promptLogPath;

const sessionManager = await import(
  pathToFileURL(join(repoRoot, 'backend', 'session', 'manager.mjs')).href
);
const metaStore = await import(
  pathToFileURL(join(repoRoot, 'backend', 'session', 'meta-store.mjs')).href
);
const workbenchStateStore = await import(
  pathToFileURL(join(repoRoot, 'backend', 'workbench', 'state-store.mjs')).href
);

const {
  createSession,
  sendMessage,
  killAll,
} = sessionManager;
const {
  loadSessionsMeta,
} = metaStore;
const {
  loadWorkbenchState,
} = workbenchStateStore;

async function waitFor(predicate, description, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${description}`);
}

try {
  const pmLoopRoot = await createSession(tempHome, 'fake-codex', 'PM Loop / PMA', {
    group: '长期任务',
    description: 'Maintain the long-term product iteration tree.',
    persistent: {
      kind: 'recurring_task',
      recurring: {
        cadence: 'daily',
        timeOfDay: '09:30',
      },
    },
  });

  const melodySyncRoot = await createSession(tempHome, 'fake-codex', 'MelodySync Session Map', {
    group: 'MelodySync',
    description: 'Refine session-first task map routing and attach rules.',
  });

  await createSession(tempHome, 'fake-codex', 'MelodySync Branch', {
    group: 'MelodySync',
    description: 'Branch work under the MelodySync map.',
    rootSessionId: melodySyncRoot.id,
    sourceContext: {
      parentSessionId: melodySyncRoot.id,
    },
  });

  await createSession(tempHome, 'fake-codex', 'Video Review', {
    group: 'Video',
    description: 'Review rough-cut pacing and shot order.',
  });

  const target = await createSession(tempHome, 'fake-codex', 'Map Attach Draft');

  const firstOutcome = await sendMessage(
    target.id,
    'Please tighten the MelodySync session map attach rules and keep the task-map flow coherent.',
    [],
    {
      tool: 'fake-codex',
      model: 'fake-model',
      effort: 'low',
    },
  );

  assert.ok(firstOutcome?.run?.id, 'first send should return a run id');
  await waitFor(
    async () => (readFileSync(promptLogPath, 'utf8').match(/---PROMPT---/g) || []).length >= 1,
    'first prompt log entry',
  );

  const prompts = readFileSync(promptLogPath, 'utf8')
    .split('---PROMPT---\n')
    .map((entry) => entry.trim())
    .filter(Boolean);

  assert.equal(prompts.length, 1, 'the first visible send should produce one logged prompt');
  assert.match(prompts[0], /\[Task map routing hints\]/);
  assert.match(prompts[0], /Candidate long-term task maps:/);
  assert.match(prompts[0], /PM Loop \/ PMA/);
  assert.match(prompts[0], /group: 长期任务/);
  assert.doesNotMatch(prompts[0], /Candidate main task maps:/);
  assert.doesNotMatch(prompts[0], /MelodySync Session Map/);
  assert.doesNotMatch(prompts[0], /children: 1/);
  assert.doesNotMatch(prompts[0], /Video Review/);
  assert.doesNotMatch(prompts[0], /MelodySync Branch \(sessionId:/);

  await waitFor(async () => {
    const sessionsMeta = await loadSessionsMeta();
    const attachedTarget = sessionsMeta.find((entry) => entry.id === target.id) || null;
    return attachedTarget?.sourceContext?.parentSessionId === pmLoopRoot.id;
  }, 'auto-attach session metadata');

  const sessionsMeta = await loadSessionsMeta();
  const attachedMeta = sessionsMeta.find((entry) => entry.id === target.id) || null;
  const workbenchState = await loadWorkbenchState();
  const attachedTarget = (workbenchState.branchContexts || []).find((entry) => entry.sessionId === target.id) || null;
  assert.equal(
    attachedMeta?.sourceContext?.parentSessionId,
    pmLoopRoot.id,
    'first-turn long-term routing should persist the matched long-term root as the parent session id',
  );
  assert.equal(
    attachedMeta?.rootSessionId,
    pmLoopRoot.id,
    'auto-attached sessions should inherit the long-term root session id in stored metadata',
  );
  assert.equal(
    attachedMeta?.taskCard?.lineRole,
    'branch',
    'auto-attached sessions should switch the stored taskCard into branch mode',
  );
  assert.equal(
    attachedMeta?.taskCard?.branchFrom,
    'PM Loop / PMA',
    'auto-attached sessions should persist the matched long-term project title in taskCard.branchFrom',
  );
  assert.equal(
    attachedTarget?.parentSessionId,
    pmLoopRoot.id,
    'first-turn long-term routing should auto-attach the new session under the matched long-term root in continuity state',
  );
  assert.equal(
    attachedTarget?.lineRole,
    'branch',
    'auto-attached sessions should become branch nodes in the long-term task map',
  );
  assert.equal(attachedTarget?.branchFrom, 'PM Loop / PMA', 'auto-attached sessions should point branchFrom at the matched long-term project');

  console.log('test-session-first-message-task-map-routing-context: ok');
} finally {
  killAll();
  rmSync(tempHome, { recursive: true, force: true });
}
