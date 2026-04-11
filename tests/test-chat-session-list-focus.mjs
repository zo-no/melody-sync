#!/usr/bin/env node
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const sessionListUiSource = readFileSync(join(repoRoot, 'frontend-src', 'session-list', 'ui.js'), 'utf8');
const sessionListReactSource = readFileSync(join(repoRoot, 'frontend-src', 'workbench', 'task-map-react-ui.jsx'), 'utf8');
const sidebarStylesheet = readFileSync(join(repoRoot, 'frontend-src', 'chat-sidebar.css'), 'utf8');

assert.doesNotMatch(
  sessionListUiSource,
  /getSessionFocusReason|getSessionFocusSectionData|renderFocusSection|session-focus-section/,
  'session list fallback renderer should not keep a focus/reminder section path',
);

assert.doesNotMatch(
  sessionListReactSource,
  /SessionListFocusSection|session-focus-section/,
  'React session-list renderer should not keep the retired focus/reminder section',
);

assert.doesNotMatch(
  sidebarStylesheet,
  /\.session-focus-section\s*\{/,
  'sidebar stylesheet should not keep styles for the retired focus/reminder section',
);

console.log('test-chat-session-list-focus: ok');
