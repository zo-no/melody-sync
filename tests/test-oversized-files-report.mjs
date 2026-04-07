#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  formatOversizedFilesReport,
  loadOversizedFilesBaseline,
  scanOversizedFiles,
} from '../scripts/report-oversized-files.mjs';

function createText(lineCount, prefix = 'line') {
  return Array.from({ length: lineCount }, (_, index) => `${prefix} ${index + 1}`).join('\n');
}

const tempRoot = mkdtempSync(join(tmpdir(), 'melodysync-oversized-files-'));

try {
  mkdirSync(join(tempRoot, 'backend'), { recursive: true });
  mkdirSync(join(tempRoot, 'static', 'frontend'), { recursive: true });
  mkdirSync(join(tempRoot, 'node_modules', 'ignored-package'), { recursive: true });

  writeFileSync(join(tempRoot, 'backend', 'healthy.mjs'), createText(3), 'utf8');
  writeFileSync(join(tempRoot, 'backend', 'warn.mjs'), createText(5), 'utf8');
  writeFileSync(join(tempRoot, 'static', 'frontend', 'fail.css'), createText(9), 'utf8');
  writeFileSync(join(tempRoot, 'node_modules', 'ignored-package', 'skip.mjs'), createText(20), 'utf8');
  writeFileSync(join(tempRoot, 'static', 'marked.min.js'), createText(20), 'utf8');

  const report = scanOversizedFiles(tempRoot, {
    warnLineLimits: {
      '.mjs': 4,
      '.css': 4,
    },
    failLineLimits: {
      '.mjs': 8,
      '.css': 8,
    },
  });

  assert.equal(report.scannedFileCount, 3, 'scanner should only include matching source files outside ignored paths');
  assert.deepEqual(
    report.oversizedFiles.map((entry) => ({ path: entry.path, severity: entry.severity, lines: entry.lines })),
    [
      { path: 'static/frontend/fail.css', severity: 'fail', lines: 9 },
      { path: 'backend/warn.mjs', severity: 'warn', lines: 5 },
    ],
    'scanner should classify warned and failing files by line thresholds',
  );

  const formatted = formatOversizedFilesReport(report, { githubActions: true });
  assert.match(formatted.text, /Oversized source file report: 2 file\(s\) flagged/);
  assert.match(formatted.text, /static\/frontend\/fail\.css 9 lines/);
  assert.match(formatted.text, /backend\/warn\.mjs 5 lines/);
  assert.deepEqual(
    formatted.annotations,
    [
      '::warning file=static/frontend/fail.css::Oversized source file (9 lines; warn 4, fail 8)',
      '::warning file=backend/warn.mjs::Oversized source file (5 lines; warn 4, fail 8)',
    ],
    'formatter should emit GitHub Actions warnings when requested',
  );

  writeFileSync(
    join(tempRoot, 'oversized-baseline.json'),
    JSON.stringify({
      files: {
        'backend/warn.mjs': 5,
        'static/frontend/fail.css': 9,
      },
    }, null, 2),
    'utf8',
  );

  const baseline = loadOversizedFilesBaseline(tempRoot, 'oversized-baseline.json');
  const ratchetedReport = scanOversizedFiles(tempRoot, {
    warnLineLimits: {
      '.mjs': 4,
      '.css': 4,
    },
    failLineLimits: {
      '.mjs': 8,
      '.css': 8,
    },
    baselineFiles: baseline.files,
  });

  assert.equal(ratchetedReport.oversizedFiles.length, 0, 'unchanged oversized files should be suppressed by baseline');
  assert.equal(ratchetedReport.baselineSuppressedCount, 2, 'baseline should track unchanged oversized files');

  const ratchetedFormatted = formatOversizedFilesReport(ratchetedReport, { githubActions: true });
  assert.equal(ratchetedFormatted.annotations.length, 0, 'unchanged baseline debt should not emit GitHub Actions warnings');
  assert.match(ratchetedFormatted.text, /no regressions across 3 scanned file\(s\)/i);
  assert.match(ratchetedFormatted.text, /2 baseline oversized file\(s\) remain tracked/i);

  console.log('test-oversized-files-report: ok');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
