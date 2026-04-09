#!/usr/bin/env node
import { mkdir } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const entryFile = join(repoRoot, 'frontend-src', 'workbench', 'task-map-react-ui.jsx');
const outputFile = join(repoRoot, 'frontend', 'workbench', 'task-map-react.bundle.js');

await mkdir(dirname(outputFile), { recursive: true });

await build({
  entryPoints: [entryFile],
  outfile: outputFile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  charset: 'utf8',
  minify: true,
  legalComments: 'none',
  loader: {
    '.css': 'text',
  },
  logLevel: 'info',
});
