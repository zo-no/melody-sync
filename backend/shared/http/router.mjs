/**
 * Lightweight request router.
 *
 * Usage:
 *   const router = createRouter()
 *     .use(handleFooRoutes)
 *     .use(handleBarRoutes);
 *
 *   await router.dispatch(ctx);  // returns true if handled, false otherwise
 *
 * Each handler receives the full ctx object and returns true if it handled the
 * request, false to pass to the next handler.
 */
export function createRouter() {
  const handlers = [];
  const router = {
    use(handler) {
      handlers.push(handler);
      return router;
    },
    async dispatch(ctx) {
      for (const handler of handlers) {
        if (await handler(ctx)) return true;
      }
      return false;
    },
  };
  return router;
}
