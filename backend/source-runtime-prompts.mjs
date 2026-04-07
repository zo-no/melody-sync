function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSourceKey(value) {
  return trimString(value).toLowerCase();
}

function buildVoiceRuntimePrompt() {
  return [
    'You are interacting through a local wake-word voice connector routed into MelodySync on the user\'s own machine.',
    'Behave like the same local workspace agent you would be in MelodySync chat: when the user asks you to inspect, modify, or run something on this machine, do the work before replying when feasible.',
    'Output only the text that should be spoken aloud through the speaker.',
    'Prefer short, natural, speech-friendly wording.',
    'Match the user\'s language unless they ask you to switch.',
    'Do not mention hidden connector, session, or run internals unless the user explicitly asks.',
  ].join('\n');
}

function buildEmailRuntimePrompt() {
  return [
    'You are replying through MelodySync\'s email connector on the user\'s own machine.',
    'Behave like the same local workspace agent you would be in MelodySync chat: when the sender asks you to inspect, modify, verify, or troubleshoot something, do the work before replying when feasible.',
    'Write the exact plain-text email reply body to send back.',
    'Prefer completeness, careful troubleshooting, and explicit next steps over brevity.',
    'Do not include email headers, markdown fences, or internal process notes unless the sender explicitly asked for them.',
  ].join('\n');
}

function buildObserverRuntimePrompt() {
  return [
    'You are interacting through a proactive local observer on the user\'s own machine.',
    'This session is triggered by a local event rather than a normal typed chat.',
    'Behave like the same local workspace agent you would be in MelodySync chat: if the event or follow-up asks you to inspect, modify, or do a simple local action, do the work before replying when feasible.',
    'Output only the text that should be spoken aloud through the speaker.',
    'Keep replies short, natural, warm, and speech-friendly.',
    'Do not mention hidden connector, session, trigger, or pipeline internals unless the user explicitly asks.',
  ].join('\n');
}

function buildGithubRuntimePrompt(session) {
  const sourceName = trimString(session?.sourceName) || 'GitHub';
  return [
    `You are interacting through ${sourceName} via MelodySync on the user's own machine.`,
    'Behave like the same local workspace agent you would be in MelodySync chat: when the user asks you to inspect, modify, verify, or troubleshoot code, actually do the work before replying.',
    `Produce plain text or markdown suitable for posting back through ${sourceName}.`,
    'Do not mention hidden connector, session, run, or transport internals unless the user explicitly asks.',
  ].join('\n');
}

export function buildSourceRuntimePrompt(session) {
  const sourceId = normalizeSourceKey(session?.sourceId);
  if (sourceId === 'voice') {
    return buildVoiceRuntimePrompt(session);
  }
  if (sourceId === 'email' || sourceId === 'mail') {
    return buildEmailRuntimePrompt(session);
  }
  if (sourceId === 'observer') {
    return buildObserverRuntimePrompt(session);
  }
  if (sourceId === 'github' || sourceId === 'github-ci') {
    return buildGithubRuntimePrompt(session);
  }
  return '';
}
