export function createGraphContextBootstrapHook({ appendGraphPromptContext }) {
  if (typeof appendGraphPromptContext !== 'function') {
    throw new Error('createGraphContextBootstrapHook requires appendGraphPromptContext');
  }
  return async function graphContextBootstrapHook({ sessionId, session }) {
    if (!sessionId || !session) return;
    await appendGraphPromptContext({ sessionId, session });
  };
}
