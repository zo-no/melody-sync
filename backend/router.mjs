/**
 * Top-level HTTP dispatcher for chat-server.mjs.
 *
 * Request flow:
 *   1. Static assets  → handleStaticHttpRoutes  (versioned /chat/* files, no auth)
 *   2. Public routes  → publicRouter            (login page, /api/build-info, auth endpoints)
 *   3. Auth gate      → requireAuth             (rejects unauthenticated requests)
 *   4. API routes     → handleAuthenticatedHttpRoutes  (all /api/* — see that file for the route table)
 *   5. Fallback       → 404
 *
 * To add a new public (unauthenticated) route: add a handler to publicRouter.
 * To add a new authenticated route: see authenticated-routes.mjs.
 */
import { parse as parseUrl } from 'url';
import {
  setSecurityHeaders, generateNonce, requireAuth,
} from './middleware.mjs';
import { handleAuthenticatedHttpRoutes } from './controllers/http/authenticated-routes.mjs';
import { handleStaticHttpRoutes } from './controllers/http/static-routes.mjs';
import { handlePublicAuthRoutes } from './controllers/public/auth-routes.mjs';
import { handlePublicPageRoutes } from './controllers/public/page-routes.mjs';
import {
  SERVICE_BUILD_INFO,
} from './services/system/page-build-service.mjs';
import { createResponseCacheHelpers } from './shared/http/response-cache.mjs';
import { createRouter } from './shared/http/router.mjs';

const {
  prepareResponseBody,
  createWriteJsonWriter,
  writeJsonCached,
  writeFileCached,
} = createResponseCacheHelpers({
  defaultHeaders: {
    'X-MelodySync-Build': SERVICE_BUILD_INFO.title,
  },
});

function buildHeaders(headers = {}) {
  return {
    'X-MelodySync-Build': SERVICE_BUILD_INFO.title,
    ...headers,
  };
}

const publicRouter = createRouter()
  .use(handlePublicAuthRoutes)
  .use(handlePublicPageRoutes);

export async function handleRequest(req, res) {
  const parsedUrl = parseUrl(req.url, true);
  const pathname = parsedUrl.pathname;

  if (await handleStaticHttpRoutes({
    req,
    res,
    pathname,
    query: parsedUrl.query,
    writeFileCached,
    buildHeaders,
  })) {
    return;
  }

  const nonce = generateNonce();
  setSecurityHeaders(res, nonce);

  const publicCtx = { req, res, parsedUrl, pathname, nonce, buildHeaders, prepareResponseBody, writeJsonCached };
  if (await publicRouter.dispatch(publicCtx)) {
    return;
  }

  // Auth required from here on
  if (!requireAuth(req, res)) return;

  if (await handleAuthenticatedHttpRoutes({
    req,
    res,
    parsedUrl,
    pathname,
    nonce,
    createWriteJsonWriter,
    writeJsonCached,
    writeFileCached,
    prepareResponseBody,
    buildHeaders,
  })) {
    return;
  }

  res.writeHead(404, buildHeaders({ 'Content-Type': 'text/plain' }));
  res.end('Not Found');
}
