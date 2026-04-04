#!/usr/bin/env node
import { randomBytes } from 'crypto';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { AUTH_FILE, CHAT_PORT } from './lib/config.mjs';

const authFile = AUTH_FILE;
const authDir = dirname(authFile);

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

await mkdir(authDir, { recursive: true });

const token = randomBytes(32).toString('hex');
let existing = {};
if (await pathExists(authFile)) {
  try {
    existing = JSON.parse(await readFile(authFile, 'utf8')) || {};
  } catch {}
}

await writeFile(authFile, JSON.stringify({ ...existing, token }, null, 2), 'utf8');

console.log(`Auth token generated and written to: ${authFile}`);
console.log(`\nYour access token: ${token}`);
console.log(`\nAccess URL (local):`);
console.log(`  http://127.0.0.1:${CHAT_PORT}/?token=${token}`);
