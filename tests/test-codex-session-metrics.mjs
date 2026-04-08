#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-codex-metrics-'));
const sessionsDir = join(tempHome, '.codex', 'sessions', '2026', '04', '08');
process.env.HOME = tempHome;
delete process.env.CODEX_HOME;

mkdirSync(sessionsDir, { recursive: true });
writeFileSync(
  join(sessionsDir, 'rollout-2026-04-08T12-00-00-overflow-thread.jsonl'),
  `${JSON.stringify({
    timestamp: '2026-04-08T12:00:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: 101,
          output_tokens: 7,
          total_tokens: 108,
        },
        last_token_usage: {
          input_tokens: 101,
          output_tokens: 7,
          total_tokens: 108,
        },
        model_context_window: 100,
      },
    },
  })}\n`,
  'utf8',
);

const metricsModule = await import(
  pathToFileURL(join(repoRoot, 'backend', 'codex-session-metrics.mjs')).href
);

const { findCodexSessionLog, readLatestCodexSessionMetrics } = metricsModule;

const sessionLogPath = await findCodexSessionLog('overflow-thread');
assert.match(sessionLogPath || '', /overflow-thread\.jsonl$/);

const metrics = await readLatestCodexSessionMetrics('overflow-thread');
assert.equal(metrics?.contextTokens, 101);
assert.equal(metrics?.contextWindowTokens, 100);
assert.equal(metrics?.inputTokens, 101);
assert.equal(metrics?.outputTokens, 7);

console.log('test-codex-session-metrics: ok');
