import assert from 'assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'remotelab-system-prompt-'));
process.env.HOME = tempHome;
process.env.REMOTELAB_MEMORY_DIR = path.join(tempHome, 'instance-data', 'memory');

const { buildSystemContext } = await import('../backend/system-prompt.mjs');

const context = await buildSystemContext({ sessionId: 'session-test-123' });

assert.match(context, /Seed Layer — Editable Default Constitution/);
assert.match(context, /editable seed layer, not permanent law/);
assert.match(context, /Session-First Routing/);
assert.doesNotMatch(context, /Template-Session-First Routing/);
assert.match(context, /Manager Policy Boundary/);
assert.match(context, /Treat provider runtimes such as Codex or Claude as execution engines/);
assert.match(context, /synchronize principles, boundaries, and default assembly rules/);
assert.match(context, /For normal conversation and conceptual discussion, default to natural connected prose/);
assert.match(context, /state-first reorientation: current execution state, whether the user is needed now, or whether the work can stay parked for later/);
assert.match(context, /do not mirror its headings, bullets, or checklist structure back to the user/);
assert.match(context, /Context Topology/);
assert.match(context, /Session Continuity/);
assert.match(context, /Bounded work should prefer bounded context/);
assert.match(context, /Do not look for or invent App templates, base sessions, public share flows, or scheduled triggers/);
assert.match(context, /Legacy `appId`, `appName`, or template-flavored metadata may still appear in stored data/);
assert.match(context, /Delegation And Child Sessions/);
assert.match(context, /available internal capability, not as the default shape of every task/);
assert.match(context, /independent worker that simply received bounded handoff context/);
assert.match(context, /2\+ independently actionable goals/);
assert.match(context, /clear no-split reason/);
assert.match(context, /parent session may coordinate while each child session owns one goal/);
assert.match(context, /melodysync session-spawn --task/);
assert.match(context, /--wait --json/);
assert.match(context, /Keep spawned-session handoff minimal/);
assert.match(context, /focused task plus the parent session id is enough/);
assert.match(context, /Do not impose a heavy handoff template by default/);
assert.match(context, /let the child fetch it from the parent session/);
assert.match(context, /REMOTELAB_SESSION_ID/);
assert.match(context, /spawn command defaults to REMOTELAB_SESSION_ID/);
assert.match(context, /session-test-123/);
assert.match(context, /Execution Bias/);
assert.match(context, /Treat a clear user request as standing permission to carry the task forward until it reaches a meaningful stopping point/);
assert.match(context, /Default to continuing after partial progress instead of stopping to ask whether you should proceed/);
assert.match(context, /Prefer doing the next reasonable, reversible step over describing what you could do next/);
assert.match(context, /Pause only for a real blocker: an explicitly requested stop\/wait, missing credentials or external information you cannot obtain yourself, a destructive or irreversible action without clear authorization, or a decision that only the user can make/);
assert.match(context, /Do not treat the absence of micro-instructions as a blocker; execution-layer decisions are part of your job/);
assert.match(context, /MelodySync self-hosting development/);
assert.match(context, /Read .*AGENTS\.md first when it exists/, 'system prompt should point the agent at the user-editable MelodySync AGENTS file');
assert.match(context, /Use .*AGENTS\.md to decide whether the active managed scope is only MelodySync program data or the broader configured local workspace/, 'system prompt should treat AGENTS as the authority for workspace scope');
assert.match(context, /MelodySync Agent Guide Missing/, 'system prompt should mention the missing AGENTS guide when it is absent');
assert.match(context, /~\/instance-data\/memory\//);
assert.doesNotMatch(context, /~\/\.remotelab\/memory\//);

console.log('test-system-prompt: ok');
