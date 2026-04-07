#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const home = mkdtempSync(join(tmpdir(), 'melodysync-run-spool-policy-'));
const previousHome = process.env.HOME;
process.env.HOME = home;

try {
  const {
    appendRunSpoolRecord,
    createRun,
    materializeRunSpoolLine,
    readRunSpoolRecords,
    runArtifactsDir,
  } = await import('../backend/runs.mjs');

  const run = await createRun({
    status: {
      sessionId: 'session_spool_policy',
      requestId: 'req_spool_policy',
      state: 'accepted',
      tool: 'fake-codex',
    },
    manifest: {
      sessionId: 'session_spool_policy',
      requestId: 'req_spool_policy',
      folder: '~',
      tool: 'fake-codex',
      prompt: 'hi',
      options: {},
    },
  });

  const hugeOutput = 'o'.repeat(256 * 1024);
  const hugeReasoning = 'r'.repeat(128 * 1024);

  await appendRunSpoolRecord(run.id, {
    stream: 'stdout',
    line: JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: 'echo hi',
        aggregated_output: hugeOutput,
        exit_code: 0,
        status: 'completed',
      },
    }),
    json: {
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: 'echo hi',
        aggregated_output: hugeOutput,
        exit_code: 0,
        status: 'completed',
      },
    },
  });

  await appendRunSpoolRecord(run.id, {
    stream: 'stdout',
    line: JSON.stringify({
      type: 'item.completed',
      item: {
        type: 'reasoning',
        text: hugeReasoning,
      },
    }),
    json: {
      type: 'item.completed',
      item: {
        type: 'reasoning',
        text: hugeReasoning,
      },
    },
  });

  const records = await readRunSpoolRecords(run.id);
  assert.equal(records.length, 2, 'structured spool records should round-trip');

  const commandRecord = records[0];
  assert.equal(commandRecord.line, undefined, 'structured records should not persist a duplicate line string');
  assert.equal(commandRecord.lineArtifact, undefined, 'structured records should not spill duplicate JSON into line artifacts');
  assert.equal(commandRecord.json.item.aggregated_outputTruncated, true, 'long command output should be stored as preview only');
  assert.equal(commandRecord.json.item.aggregated_outputBytes, hugeOutput.length, 'command output should keep original byte count');
  assert.equal(commandRecord.json.item.aggregated_output.includes('[... truncated by MelodySync ...]'), true, 'command output preview should carry a truncation marker');

  const reasoningRecord = records[1];
  assert.equal(reasoningRecord.line, undefined, 'reasoning records should also omit duplicate line strings');
  assert.equal(reasoningRecord.json.item.textTruncated, true, 'long reasoning text should be stored as preview only');
  assert.equal(reasoningRecord.json.item.textBytes, hugeReasoning.length, 'reasoning text should keep original byte count');

  const materializedCommand = JSON.parse(await materializeRunSpoolLine(run.id, commandRecord));
  assert.equal(materializedCommand.item.command, 'echo hi', 'materialized structured records should remain parseable');
  assert.equal(materializedCommand.item.aggregated_outputBytes, hugeOutput.length, 'materialized command record should preserve original byte count');
  assert.equal(materializedCommand.item.aggregated_output.length < hugeOutput.length, true, 'materialized command output should stay truncated');

  const artifactFiles = readdirSync(runArtifactsDir(run.id));
  assert.deepEqual(artifactFiles, [], 'preview-only structured fields should not create artifact files');

  console.log('test-run-spool-storage-policy: ok');
} finally {
  process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
}
