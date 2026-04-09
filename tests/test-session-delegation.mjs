#!/usr/bin/env node
import assert from 'assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const home = mkdtempSync(join(tmpdir(), 'melodysync-session-delegate-'));
process.env.HOME = home;

const configDir = join(home, '.config', 'melody-sync');
const localBin = join(home, '.local', 'bin');
const workspace = join(home, 'workspace');
mkdirSync(configDir, { recursive: true });
mkdirSync(localBin, { recursive: true });
mkdirSync(workspace, { recursive: true });

writeFileSync(
  join(configDir, 'tools.json'),
  `${JSON.stringify([
    {
      id: 'fake-codex',
      name: 'Fake Codex',
      command: 'fake-codex',
      runtimeFamily: 'codex-json',
      models: [{ id: 'fake-model', label: 'Fake model', defaultEffort: 'low' }],
      reasoning: { kind: 'enum', label: 'Reasoning', levels: ['low'], default: 'low' },
    },
  ], null, 2)}\n`,
  'utf8',
);
writeFileSync(
  join(localBin, 'fake-codex'),
  `#!/usr/bin/env node
const delay = Number(process.env.FAKE_CODEX_DELAY_MS || '150');
let cancelled = false;
process.on('SIGTERM', () => {
  cancelled = true;
  setTimeout(() => process.exit(143), 20);
});
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-test' }));
console.log(JSON.stringify({ type: 'turn.started' }));
setTimeout(() => {
  if (cancelled) return;
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'command_execution', command: 'echo fake', aggregated_output: 'fake', exit_code: 0, status: 'completed' }
  }));
  console.log(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'finished from fake codex' }
  }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 1, output_tokens: 1 }
  }));
}, delay);
`,
  'utf8',
);
chmodSync(join(localBin, 'fake-codex'), 0o755);
process.env.FAKE_CODEX_DELAY_MS = '150';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, description, timeoutMs = 10000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out: ${description}`);
}

const {
  createSession,
  delegateSession,
  getHistory,
  getSession,
  killAll,
  submitHttpMessage,
} = await import('../backend/session/manager.mjs');
const { getRun, getRunManifest, isTerminalRunState } = await import('../backend/run/store.mjs');

try {
  const parent = await createSession(workspace, 'fake-codex', 'Delegate parent', {
    group: 'Tests',
    description: 'Delegate route contract',
  });
  const parentOutcome = await submitHttpMessage(
    parent.id,
    'Please investigate the workflow design problem before delegating',
    [],
    { requestId: 'req-delegate-parent' },
  );
  await waitFor(async () => {
    const run = await getRun(parentOutcome.run.id);
    return run && isTerminalRunState(run.state) ? run : false;
  }, 'parent run should finish');

  const delegateOutcome = await delegateSession(parent.id, {
    task: 'Figure out a lightweight child-session strategy for parallel work.',
  });
  assert.ok(delegateOutcome?.session?.id, 'delegate should create a child session');
  assert.ok(delegateOutcome?.run?.id, 'delegate should start the child session immediately');
  assert.notEqual(delegateOutcome.session.id, parent.id, 'delegate should create a distinct child session id');

  const childRun = await waitFor(async () => {
    const run = await getRun(delegateOutcome.run.id);
    return run && isTerminalRunState(run.state) ? run : false;
  }, 'delegated child run should finish');
  assert.equal(childRun.state, 'completed', 'delegated child run should complete');

  const manifest = await getRunManifest(delegateOutcome.run.id);
  assert.match(manifest?.prompt || '', /Figure out a lightweight child-session strategy for parallel work\./, 'delegated prompt should include the requested child task');
  assert.match(manifest?.prompt || '', new RegExp(`Parent session id: ${parent.id}`), 'delegated prompt should include the parent session id');
  assert.doesNotMatch(manifest?.prompt || '', /Please investigate the workflow design problem before delegating/, 'delegated prompt should omit the latest parent user message by default');
  assert.doesNotMatch(manifest?.prompt || '', /finished from fake codex/, 'delegated prompt should omit the latest parent assistant result by default');
  assert.doesNotMatch(manifest?.prompt || '', /echo fake/, 'delegated prompt should omit intermediate tool details from the parent');

  const parentEvents = await getHistory(parent.id);
  const delegateNotice = parentEvents.find((event) => event.type === 'message' && event.role === 'assistant' && event.messageKind === 'session_delegate_notice');
  assert.ok(delegateNotice, 'delegation should append a visible handoff note to the parent session');
  assert.match(delegateNotice.content || '', /Spawned a parallel session/, 'handoff note should describe the spawn');
  assert.match(delegateNotice.content || '', new RegExp(`session=${delegateOutcome.session.id}`), 'handoff note should include a direct session link');

  const running = await createSession(workspace, 'fake-codex', 'Delegate busy', {
    group: 'Tests',
    description: 'Delegate while running',
  });
  const runningOutcome = await submitHttpMessage(
    running.id,
    'slow run for delegate rejection',
    [],
    { requestId: 'req-delegate-busy' },
  );
  await waitFor(async () => {
    const run = await getRun(runningOutcome.run.id);
    return run?.state === 'running' ? run : false;
  }, 'source session should still be running before delegation');

  const runningDelegate = await delegateSession(running.id, {
    task: 'Spawn a child anyway',
  });
  assert.ok(runningDelegate?.session?.id, 'running-source delegation should still create a child session');
  assert.ok(runningDelegate?.run?.id, 'running-source delegation should still create a child run');

  const runningChild = await waitFor(async () => {
    const run = await getRun(runningDelegate.run.id);
    return run && isTerminalRunState(run.state) ? run : false;
  }, 'running-source delegated child should finish');
  assert.equal(runningChild.state, 'completed', 'delegated child from a running parent should also complete');

  const loadedChild = await getSession(delegateOutcome.session.id);
  assert.equal(loadedChild?.delegatedFromSessionId, undefined, 'delegate should not persist parent-child metadata on the child session');
  assert.equal(loadedChild?.rootSessionId, undefined, 'delegate should not persist lineage metadata on the child session');
  assert.equal(loadedChild?.delegatedAt, undefined, 'delegate should not persist delegated timestamps on the child session');

  console.log('test-session-delegation: ok');
} finally {
  killAll();
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
