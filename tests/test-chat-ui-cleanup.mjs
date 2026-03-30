#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const sources = {
  messages: readFileSync(join(repoRoot, 'static/chat/chat-messages.css'), 'utf8'),
  workbench: readFileSync(join(repoRoot, 'static/chat/chat-workbench.css'), 'utf8'),
  input: readFileSync(join(repoRoot, 'static/chat/chat-input.css'), 'utf8'),
  responsive: readFileSync(join(repoRoot, 'static/chat/chat-responsive.css'), 'utf8'),
  base: readFileSync(join(repoRoot, 'static/chat/chat-base.css'), 'utf8'),
  workbenchUI: readFileSync(join(repoRoot, 'static/chat/workbench-ui.js'), 'utf8'),
};

assert.ok(/\.empty-state\s*\{[\s\S]*display:\s*none\s*!?\s*important?/.test(sources.messages), 'empty state should be force-hidden in message styles');
assert.ok(!/quest-empty-state-seeded/.test(sources.workbenchUI), 'seeded empty-state branch should be removed from workbench logic');

const workbenchOverride = /\.quest-tracker[\s\S]{0,260}border:\s*1px solid var\(--border\)/.test(sources.workbench);
assert.ok(workbenchOverride, 'workbench tracker should keep high-contrast border override');

assert.ok(/\.quest-tracker-btn[\s\S]*background:\s*var\(--bg\)/.test(sources.workbench), 'workbench tracker button should have explicit flat background');
assert.ok(/\.send-btn,\s*\.cancel-btn/.test(sources.input), 'input action buttons should include high-contrast block');
assert.ok(/quest-branch-btn/.test(sources.input), 'input styles should include branch button focus treatment shared token');
assert.ok(/\.task-map-rail/.test(sources.responsive), 'responsive layout should include task-map rail cleanup');
assert.ok(/body::before\s*\{[\s\S]*display:\s*none/i.test(sources.base), 'base theme should disable decorative body pseudo background');

console.log('test-chat-ui-cleanup: ok');
