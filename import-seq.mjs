const modules = [
  './lib/release-runtime.mjs',
  './backend/router.mjs',
  './backend/api-request-log.mjs',
  './backend/ws.mjs',
  './backend/session-manager.mjs',
  './backend/session-persistent/scheduler.mjs',
  './backend/fs-utils.mjs',
  './backend/hooks/runtime/register-builtins.mjs',
  './backend/hooks/runtime/register-custom-hooks.mjs',
  './backend/hooks/runtime/registry.mjs',
  './backend/hooks/first-boot-memory-hook.mjs',
  './backend/hooks/runtime/settings-store.mjs',
  './backend/settings-store.mjs',
  './backend/voice-settings-store.mjs',
];

for (const m of modules) {
  const s = Date.now();
  console.log('IMPORT_START', m);
  try {
    await import(m);
    console.log('IMPORT_OK', m, 'ms=', Date.now() - s);
  } catch (error) {
    console.error('IMPORT_ERR', m, error && (error.stack || error.message || String(error)));
    process.exit(1);
  }
}
console.log('DONE');
