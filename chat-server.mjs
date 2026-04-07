#!/usr/bin/env node
import { join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { readActiveReleaseManifest, shouldUseActiveRelease } from './lib/release-runtime.mjs';

const sourceProjectRoot = fileURLToPath(new URL('.', import.meta.url));
let delegatedToRelease = false;

if (shouldUseActiveRelease()) {
  try {
    const activeRelease = await readActiveReleaseManifest();
    const sourceRoot = resolve(sourceProjectRoot);
    const releaseSourceRoot = activeRelease?.sourceRoot ? resolve(activeRelease.sourceRoot) : '';
    if (releaseSourceRoot && releaseSourceRoot !== sourceRoot) {
      throw new Error(
        `[release] Source root mismatch; expected ${sourceRoot}, got ${releaseSourceRoot}. ` +
        'Falling back to source runtime.',
      );
    }
    if (activeRelease?.snapshotRoot) {
      delegatedToRelease = true;
      process.env.MELODYSYNC_PROJECT_ROOT = process.env.MELODYSYNC_PROJECT_ROOT || sourceProjectRoot;
      process.env.MELODYSYNC_SOURCE_PROJECT_ROOT = process.env.MELODYSYNC_SOURCE_PROJECT_ROOT || sourceProjectRoot;
      delete process.env.MELODYSYNC_ACTIVE_RELEASE_ROOT;
      delete process.env.MELODYSYNC_ACTIVE_RELEASE_FILE;
      delete process.env.MELODYSYNC_ACTIVE_RELEASE_ID;
      process.env.MELODYSYNC_DISABLE_ACTIVE_RELEASE = '1';
      await import(pathToFileURL(join(activeRelease.snapshotRoot, 'chat-server.mjs')).href);
    }
  } catch (error) {
    console.error(`[release] Failed to boot the active release: ${error.message}`);
    console.error('[release] Falling back to the source runtime');
    delegatedToRelease = false;
  }
}

if (!delegatedToRelease) {
  const http = await import('http');
  const [{ CHAT_PORT, CHAT_BIND_HOST, SECURE_COOKIES, MEMORY_DIR }, { handleRequest }, apiRequestLog, ws, sessionManager, persistentScheduler, { ensureDir }, { registerBuiltinHooks }, { registerCustomHooks }, { emit: emitHook }, { isFirstBootMemoryState }, { loadPersistedHookSettings }, { ensureGeneralSettingsRuntimeFiles }, { ensureVoiceSettingsRuntimeFiles }] = await Promise.all([
    import('./lib/config.mjs'),
    import('./backend/router.mjs'),
    import('./backend/api-request-log.mjs'),
    import('./backend/ws.mjs'),
    import('./backend/session-manager.mjs'),
    import('./backend/session-persistent-scheduler.mjs'),
    import('./backend/fs-utils.mjs'),
    import('./backend/hooks/runtime/register-builtins.mjs'),
    import('./backend/hooks/runtime/register-custom-hooks.mjs'),
    import('./backend/hooks/runtime/registry.mjs'),
    import('./backend/hooks/first-boot-memory-hook.mjs'),
    import('./backend/hooks/runtime/settings-store.mjs'),
    import('./backend/settings-store.mjs'),
    import('./backend/voice-settings-store.mjs'),
  ]);

  registerBuiltinHooks();
  await Promise.all([
    ensureDir(MEMORY_DIR),
    ensureDir(join(MEMORY_DIR, 'tasks')),
    ensureGeneralSettingsRuntimeFiles(),
    ensureVoiceSettingsRuntimeFiles(),
    apiRequestLog.initApiRequestLog(),
    registerCustomHooks(),
  ]);
  await loadPersistedHookSettings();

  const server = http.createServer((req, res) => {
    const requestLog = apiRequestLog.startApiRequestLog(req, res);
    handleRequest(req, res).catch(err => {
      requestLog.markError(err);
      console.error('Unhandled request error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    });
  });

  ws.attachWebSocket(server);

  async function shutdown() {
    console.log('Shutting down chat server...');
    persistentScheduler.stopPersistentSessionScheduler();
    await apiRequestLog.closeApiRequestLog();
    sessionManager.killAll();
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  async function runDeferredStartupHooks() {
    try {
      await emitHook('instance.startup', {
        sessionId: '',
        session: null,
        manifest: null,
      });
      if (await isFirstBootMemoryState()) {
        await emitHook('instance.first_boot', {
          sessionId: '',
          session: null,
          manifest: null,
        });
      }
    } catch (error) {
      console.error('Failed to run deferred startup hooks:', error);
    }
  }

  server.listen(CHAT_PORT, CHAT_BIND_HOST, () => {
    console.log(`Chat server listening on http://${CHAT_BIND_HOST}:${CHAT_PORT}`);
    console.log(`Cookie mode: ${SECURE_COOKIES ? 'Secure (HTTPS)' : 'Non-secure (localhost)'}`);
    persistentScheduler.startPersistentSessionScheduler();
    void runDeferredStartupHooks();
    try {
      console.log('Startup: rehydrating detached runs...');
      void sessionManager.startDetachedRunObservers().then(() => {
        console.log('Startup: detached run rehydration complete');
      }).catch((error) => {
        console.error('Failed to rehydrate detached runs on startup:', error);
      });
    } catch (error) {
      console.error('Failed to rehydrate detached runs on startup:', error);
    }
  });
}
