import { handlePublicAuthRoutes } from '../controllers/public/auth-routes.mjs';
import { handlePublicPageRoutes } from '../controllers/public/page-routes.mjs';

export async function handlePublicRoutes({
  req,
  res,
  parsedUrl,
  pathname,
  nonce,
  buildHeaders,
  prepareResponseBody,
  writeJsonCached,
}) {
  if (await handlePublicAuthRoutes({ req, res, parsedUrl, pathname })) return true;
  if (await handlePublicPageRoutes({
    req,
    res,
    parsedUrl,
    pathname,
    nonce,
    buildHeaders,
    prepareResponseBody,
    writeJsonCached,
  })) return true;

  return false;
}
