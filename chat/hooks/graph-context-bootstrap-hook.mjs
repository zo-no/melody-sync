export function createGraphContextBootstrapHook({ appendGraphPromptContext }) {
  if (typeof appendGraphPromptContext !== 'function') {
    throw new Error('createGraphContextBootstrapHook requires appendGraphPromptContext');
  }
  return async function graphContextBootstrapHook({ sessionId, session }) {
    if (!sessionId || !session) return;
    await appendGraphPromptContext({ sessionId, session });
  };
}

export function createLegacyGraphContextBootstrapHook({ appendEvents, buildGraphPromptContext }) {
  if (typeof appendEvents !== 'function') {
    throw new Error('createLegacyGraphContextBootstrapHook requires appendEvents');
  }
  if (typeof buildGraphPromptContext !== 'function') {
    throw new Error('createLegacyGraphContextBootstrapHook requires buildGraphPromptContext');
  }

  return async function graphContextBootstrapHook({ sessionId, session }) {
    if (!sessionId || !session) return;
    const content = await buildGraphPromptContext({ sessionId, session });
    if (typeof content !== 'string' || !content.trim()) return;
    await appendEvents(sessionId, [
      {
        type: 'template_context',
        role: 'system',
        templateName: 'graph-planning',
        content: content.trim(),
      },
    ]);
  };
}
