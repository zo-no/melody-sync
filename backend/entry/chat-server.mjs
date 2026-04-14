#!/usr/bin/env node
import { join } from 'path';
import { fileURLToPath } from 'url';

const sourceProjectRoot = fileURLToPath(new URL('../../', import.meta.url));

{
  const http = await import('http');
  const [
    { CHAT_PORT, CHAT_BIND_HOST, SECURE_COOKIES, MEMORY_DIR },
    { handleRequest },
    apiRequestLog,
    ws,
    sessionManager,
    persistentScheduler,
    { ensureDir },
    { registerBuiltinHooks },
    { registerCustomHooks },
    { emit: emitHook },
    { isFirstBootMemoryState },
    { loadPersistedHookSettings },
    { ensureGeneralSettingsRuntimeFiles },
    { ensureVoiceSettingsRuntimeFiles },
    {
      resumeHostCompletionSpeechQueue,
      startHostCompletionSpeechQueueWatchdog,
      stopHostCompletionSpeechQueueWatchdog,
    },
  ] = await Promise.all([
    import('../../lib/config.mjs'),
    import('../router.mjs'),
    import('../api-request-log.mjs'),
    import('../ws.mjs'),
    import('../session/manager.mjs'),
    import('../session-persistent/scheduler.mjs'),
    import('../fs-utils.mjs'),
    import('../hooks/runtime/register-builtins.mjs'),
    import('../hooks/runtime/register-custom-hooks.mjs'),
    import('../hooks/runtime/registry.mjs'),
    import('../hooks/first-boot-memory-hook.mjs'),
    import('../hooks/runtime/settings-store.mjs'),
    import('../settings/general-store.mjs'),
    import('../settings/voice-store.mjs'),
    import('../completion-speech-queue.mjs'),
  ]);

  registerBuiltinHooks();
  const { ensureBuiltinProjects } = await import('../session/system-project.mjs');
  await Promise.all([
    ensureDir(MEMORY_DIR),
    ensureDir(join(MEMORY_DIR, 'tasks')),
    ensureGeneralSettingsRuntimeFiles(),
    ensureVoiceSettingsRuntimeFiles(),
    apiRequestLog.initApiRequestLog(),
    registerCustomHooks(),
    ensureBuiltinProjects(),
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
    stopHostCompletionSpeechQueueWatchdog();
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
    try {
      console.log('Startup: resuming host completion speech queue...');
      void resumeHostCompletionSpeechQueue().catch((error) => {
        console.error('Failed to resume host completion speech queue on startup:', error);
      });
      startHostCompletionSpeechQueueWatchdog();
    } catch (error) {
      console.error('Failed to resume host completion speech queue on startup:', error);
    }
  });
}
