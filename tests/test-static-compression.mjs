#!/usr/bin/env node
import assert from 'assert/strict';
import { brotliDecompressSync, gunzipSync } from 'zlib';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const cookie = 'session_token=test-session';

function randomPort() {
  return 45000 + Math.floor(Math.random() * 10000);
}

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

function request(port, path, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: {
          Cookie: cookie,
          ...extraHeaders,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
            text: body.toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function setupTempHome() {
  const home = mkdtempSync(join(tmpdir(), 'melodysync-static-compression-'));
  const configDir = join(home, '.config', 'melody-sync');
  mkdirSync(configDir, { recursive: true });

  writeFileSync(
    join(configDir, 'auth.json'),
    JSON.stringify({ token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(configDir, 'auth-sessions.json'),
    JSON.stringify({
      'test-session': { expiry: Date.now() + 60 * 60 * 1000, role: 'owner' },
    }, null, 2),
    'utf8',
  );

  return { home };
}

async function startServer({ home, port }) {
  const child = spawn(process.execPath, ['chat-server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      CHAT_PORT: String(port),
      SECURE_COOKIES: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitFor(async () => {
    try {
      const res = await request(port, '/login', { Cookie: '' });
      return res.status === 200;
    } catch {
      return false;
    }
  }, 'server startup');

  return { child };
}

async function stopServer(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await waitFor(() => server.child.exitCode !== null, 'server shutdown');
}

async function main() {
  const { home } = setupTempHome();
  const port = randomPort();
  const probeName = `__compression_probe_${Date.now().toString(36)}.js`;
  const probePath = join(repoRoot, 'frontend', probeName);
  const probeSource = `window.__MELODYSYNC_COMPRESSION_PROBE__ = "${'x'.repeat(4096)}";\n`;
  writeFileSync(probePath, probeSource, 'utf8');

  const server = await startServer({ home, port });
  try {
    const brProbe = await request(port, `/chat/${probeName}`, {
      'Accept-Encoding': 'br, gzip',
    });
    assert.equal(brProbe.status, 200, 'brotli probe request should succeed');
    assert.equal(brProbe.headers['content-encoding'], 'br', 'brotli should be preferred when accepted');
    assert.match(brProbe.headers.vary || '', /Accept-Encoding/i, 'compressed assets should vary by Accept-Encoding');
    assert.equal(
      brotliDecompressSync(brProbe.body).toString('utf8'),
      probeSource,
      'brotli-compressed asset should decompress to the original source',
    );

    const gzipProbe = await request(port, `/chat/${probeName}`, {
      'Accept-Encoding': 'gzip',
    });
    assert.equal(gzipProbe.status, 200, 'gzip probe request should succeed');
    assert.equal(gzipProbe.headers['content-encoding'], 'gzip', 'gzip should be used when brotli is unavailable');
    assert.equal(
      gunzipSync(gzipProbe.body).toString('utf8'),
      probeSource,
      'gzip-compressed asset should decompress to the original source',
    );

    const brProbe304 = await request(port, `/chat/${probeName}`, {
      'Accept-Encoding': 'br',
      'If-None-Match': brProbe.headers.etag,
    });
    assert.equal(brProbe304.status, 304, 'compressed asset should preserve conditional requests');
    assert.equal(brProbe304.headers['content-encoding'], 'br', '304 should keep the negotiated encoding metadata');

    const page = await request(port, '/', {
      'Accept-Encoding': 'br',
    });
    assert.equal(page.status, 200, 'chat page should render');
    assert.equal(page.headers['content-encoding'], 'br', 'chat page should also use brotli when possible');
    assert.match(page.headers.vary || '', /Accept-Encoding/i, 'chat page should vary by Accept-Encoding');
    assert.match(
      brotliDecompressSync(page.body).toString('utf8'),
      /window\.__MELODYSYNC_BOOTSTRAP__/,
      'compressed chat page should decompress to HTML content',
    );

    const login = await request(port, '/login', {
      Cookie: '',
      'Accept-Encoding': 'br',
    });
    assert.equal(login.status, 200, 'login page should render');
    assert.equal(login.headers['content-encoding'], 'br', 'login page should also use brotli when possible');
    assert.match(login.headers.vary || '', /Accept-Encoding/i, 'login page should vary by Accept-Encoding');
    assert.match(
      brotliDecompressSync(login.body).toString('utf8'),
      /<title>.*Sign In/i,
      'compressed login page should decompress to HTML content',
    );

    console.log('test-static-compression: ok');
  } finally {
    await stopServer(server);
    rmSync(probePath, { force: true });
  }
}

main().catch((err) => {
  console.error('test-static-compression failed:', err);
  process.exitCode = 1;
});
