#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const sources = {
  messages: readFileSync(join(repoRoot, 'static/frontend/chat-messages.css'), 'utf8'),
  workbench: readFileSync(join(repoRoot, 'static/frontend/chat-workbench.css'), 'utf8'),
  sidebar: readFileSync(join(repoRoot, 'static/frontend/chat-sidebar.css'), 'utf8'),
  input: readFileSync(join(repoRoot, 'static/frontend/chat-input.css'), 'utf8'),
  responsive: readFileSync(join(repoRoot, 'static/frontend/chat-responsive.css'), 'utf8'),
  base: readFileSync(join(repoRoot, 'static/frontend/chat-base.css'), 'utf8'),
  workbenchUI: readFileSync(join(repoRoot, 'static/frontend/workbench/controller.js'), 'utf8'),
};

assert.ok(!/Flat visual cleanup|Flat high-contrast|Flat UI cleanup|Flat responsive cleanup|UI cleanup high-contrast/.test(sources.base + sources.messages + sources.input + sources.workbench + sources.sidebar + sources.responsive), 'legacy one-off flat cleanup blocks should be removed');
assert.ok(!/quest-empty-state-seeded/.test(sources.workbenchUI), 'seeded empty-state branch should be removed from workbench logic');
assert.ok(/quest-empty-state/.test(sources.workbenchUI), 'empty-state rendering hook should still exist for centered empty-state container reuse');
assert.ok(/body::before\s*\{[\s\S]*background:/i.test(sources.base), 'base theme should keep pseudo background for glass-like surface layering');

console.log('test-chat-ui-cleanup: ok');
