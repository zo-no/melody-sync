import { parse as parseUrl } from 'url';
import {
  setSecurityHeaders, generateNonce, requireAuth,
} from './middleware.mjs';
import { handleAuthenticatedHttpRoutes } from './controllers/http/authenticated-routes.mjs';
import { handleStaticHttpRoutes } from './controllers/http/static-routes.mjs';
import { handlePublicRoutes } from './routes/public.mjs';
import {
  SERVICE_BUILD_INFO,
} from './services/system/page-build-service.mjs';
import { createResponseCacheHelpers } from './shared/http/response-cache.mjs';

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

  if (await handlePublicRoutes({
    req,
    res,
    parsedUrl,
    pathname,
    nonce,
    buildHeaders,
    prepareResponseBody,
    writeJsonCached,
  })) {
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
