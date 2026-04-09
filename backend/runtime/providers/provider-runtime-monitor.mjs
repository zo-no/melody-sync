const DEFAULT_TRANSPORT_FAILURE_GRACE_MS = 15000;
const DEFAULT_TERMINATION_GRACE_MS = 3000;

export function parsePositiveInt(value, fallback) {
  const parsed = parseInt(String(value || '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getProviderTransportFailureGraceMs(env = process.env) {
  return parsePositiveInt(
    env.MELODYSYNC_PROVIDER_TRANSPORT_FAILURE_GRACE_MS,
    DEFAULT_TRANSPORT_FAILURE_GRACE_MS,
  );
}

export function getProviderTerminationGraceMs(env = process.env) {
  return parsePositiveInt(
    env.MELODYSYNC_PROVIDER_TERMINATION_GRACE_MS,
    DEFAULT_TERMINATION_GRACE_MS,
  );
}

export function classifyCodexTransportFailure(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  if (/failed to connect to websocket/i.test(trimmed)) {
    return {
      priority: 2,
      reason: `Codex backend connection timed out before any structured output: ${trimmed}`,
    };
  }
  if (/startup websocket prewarm setup failed/i.test(trimmed)) {
    return {
      priority: 1,
      reason: `Codex startup transport failed before any structured output: ${trimmed}`,
    };
  }
  return null;
}

export function createTerminationController(proc, {
  terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
} = {}) {
  let terminateTimer = null;

  function clearTerminateTimer() {
    if (!terminateTimer) return;
    clearTimeout(terminateTimer);
    terminateTimer = null;
  }

  function requestTermination() {
    try {
      proc.kill('SIGTERM');
    } catch {}
    clearTerminateTimer();
    terminateTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
    }, terminationGraceMs);
    if (typeof terminateTimer.unref === 'function') {
      terminateTimer.unref();
    }
  }

  return {
    clearTerminateTimer,
    requestTermination,
  };
}

export function createCodexTransportMonitor({
  runtimeFamily = '',
  graceMs = DEFAULT_TRANSPORT_FAILURE_GRACE_MS,
} = {}) {
  let providerStarted = false;
  let structuredProgressSeen = false;
  let transportFailure = null;

  function observeStdoutJson(parsed) {
    if (runtimeFamily !== 'codex-json' || !parsed || typeof parsed !== 'object') return;
    if (parsed.type === 'thread.started' || parsed.session_id) {
      providerStarted = true;
    }
    if (parsed.type === 'item.started'
      || parsed.type === 'item.updated'
      || parsed.type === 'item.completed'
      || parsed.type === 'turn.completed'
      || parsed.type === 'turn.failed'
      || parsed.type === 'error') {
      structuredProgressSeen = true;
    }
  }

  function observeStderrLine(line) {
    if (runtimeFamily !== 'codex-json' || structuredProgressSeen) return null;
    const failure = classifyCodexTransportFailure(line);
    if (!failure) return null;
    providerStarted = true;
    if (!transportFailure || failure.priority >= transportFailure.priority) {
      transportFailure = {
        ...failure,
        detectedAt: Date.now(),
      };
    }
    return transportFailure;
  }

  function getPendingFailure(now = Date.now()) {
    if (runtimeFamily !== 'codex-json') return null;
    if (!providerStarted || structuredProgressSeen || !transportFailure) return null;
    if ((now - transportFailure.detectedAt) < graceMs) return null;
    return transportFailure;
  }

  return {
    observeStdoutJson,
    observeStderrLine,
    getPendingFailure,
  };
}
