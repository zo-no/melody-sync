export function createDetachedRunObserverService({
  ensureSessionManagerBuiltinHooksRegistered,
  flushQueuedFollowUps,
  getFollowUpQueueCount,
  getRun,
  isTerminalRunState,
  loadSessionsMeta,
  observedRunPollIntervalMs = 250,
  observedRuns,
  runDir,
  startupSyncDebug = false,
  syncDetachedRun,
  trimString,
  watch,
}) {
  function stopObservedRun(runId) {
    const observed = observedRuns.get(runId);
    if (!observed) return;
    if (observed.timer) {
      clearTimeout(observed.timer);
    }
    if (observed.poller) {
      clearInterval(observed.poller);
    }
    try {
      observed.watcher?.close();
    } catch {}
    observedRuns.delete(runId);
  }

  function scheduleObservedRunSync(runId, delayMs = 40) {
    const observed = observedRuns.get(runId);
    if (!observed) return;
    if (observed.timer) {
      clearTimeout(observed.timer);
    }
    observed.timer = setTimeout(() => {
      const current = observedRuns.get(runId);
      if (!current) return;
      current.timer = null;
      void (async () => {
        try {
          const run = await syncDetachedRun(current.sessionId, runId);
          if (!run || (isTerminalRunState(run.state) && run.finalizedAt)) {
            stopObservedRun(runId);
          }
        } catch (error) {
          console.error(`[runs] observer sync failed for ${runId}: ${error.message}`);
        }
      })();
    }, delayMs);
    if (typeof observed.timer.unref === 'function') {
      observed.timer.unref();
    }
  }

  function observeDetachedRun(sessionId, runId, { initialSync = true } = {}) {
    if (!runId) return false;
    const existing = observedRuns.get(runId);
    if (existing) {
      existing.sessionId = sessionId;
      return true;
    }
    try {
      const watcher = watch(runDir(runId), (_eventType, filename) => {
        if (filename) {
          const changed = String(filename);
          if (!['spool.jsonl', 'status.json', 'result.json'].includes(changed)) {
            return;
          }
        }
        scheduleObservedRunSync(runId);
      });
      watcher.on('error', (error) => {
        console.error(`[runs] observer error for ${runId}: ${error.message}`);
        stopObservedRun(runId);
      });
      const poller = setInterval(() => {
        scheduleObservedRunSync(runId, 0);
      }, observedRunPollIntervalMs);
      if (typeof poller.unref === 'function') {
        poller.unref();
      }
      observedRuns.set(runId, { sessionId, watcher, timer: null, poller });
      if (initialSync) {
        scheduleObservedRunSync(runId, 0);
      }
      return true;
    } catch (error) {
      console.error(`[runs] failed to observe ${runId}: ${error.message}`);
      return false;
    }
  }

  async function startDetachedRunObservers() {
    ensureSessionManagerBuiltinHooksRegistered();
    console.log('startup: startDetachedRunObservers enter');
    const sessionMetaList = await loadSessionsMeta();
    console.log(`startup: startDetachedRunObservers loaded ${sessionMetaList.length} sessions`);
    for (const meta of sessionMetaList) {
      const sessionId = trimString(meta?.id);
      const runId = trimString(meta?.activeRunId);
      if (!sessionId) {
        continue;
      }
      if (!runId) {
        if (getFollowUpQueueCount(meta) > 0) {
          void flushQueuedFollowUps(sessionId);
        }
        continue;
      }

      const startTs = Date.now();
      const run = await getRun(runId);

      if (run && !isTerminalRunState(run.state)) {
        observeDetachedRun(sessionId, runId, { initialSync: false });
        console.log(`Startup observed active detached run for session ${sessionId} (run ${runId})`);
        continue;
      }

      if (run && isTerminalRunState(run.state)) {
        if (!run.finalizedAt) {
          const observing = observeDetachedRun(sessionId, runId, { initialSync: true });
          if (!observing) {
            void syncDetachedRun(sessionId, runId).finally(() => {
              if (startupSyncDebug) {
                console.log(`Startup finalize-sync for completed run ${runId} in session ${sessionId} completed in ${Date.now() - startTs}ms`);
              }
            }).catch((error) => {
              console.error(`Failed to sync completed detached run for session ${sessionId} (run ${runId}): ${error.message}`);
            });
          } else if (startupSyncDebug) {
            console.log(`Startup observed terminal unfinished run for session ${sessionId} (run ${runId})`);
          }
          continue;
        }
        if (getFollowUpQueueCount(meta) > 0) {
          void flushQueuedFollowUps(sessionId);
        }
        continue;
      }

      void syncDetachedRun(sessionId, runId).finally(() => {
        if (startupSyncDebug) {
          console.log(`Startup sync for session ${sessionId} completed in ${Date.now() - startTs}ms`);
        }
      }).catch((error) => {
        console.error(`Failed to sync detached run for session ${sessionId} (run ${runId}): ${error.message}`);
      });
    }
  }

  return {
    observeDetachedRun,
    startDetachedRunObservers,
    stopObservedRun,
  };
}
