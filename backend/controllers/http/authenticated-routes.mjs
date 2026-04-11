/**
 * Authenticated route table — the single place where all /api/* routes are registered.
 *
 * HOW TO ADD A NEW ROUTE:
 *   1. Write a handler: `export async function handleMyRoutes(ctx) { ... return true/false; }`
 *   2. Import it here.
 *   3. Add `.use(handleMyRoutes)` to the router below (order matters — first match wins).
 *
 * ctx shape (available in every handler):
 *   req, res, pathname, pathParts, parsedUrl, authSession, sessionGetRoute,
 *   writeJson, writeJsonCached, writeFileCached, prepareResponseBody, buildHeaders,
 *   requireSessionAccess, getFileAsset, getFileAssetForClient, buildFileAssetDirectUrl,
 *   createFileAssetUploadIntent, finalizeFileAssetUpload,
 *   getAuthSession, refreshAuthSession, buildChatPageBootstrap, scheduleConfigReload
 *
 * INVARIANTS (do not break):
 *   - Auth check (owner-only routes) happens before dispatch — never skip it.
 *   - sessionGetRoute is only set for GET requests; write handlers must parse pathname themselves.
 *   - pathParts = pathname.split('/').filter(Boolean) — pre-parsed, no need to split again.
 */
import {
  getAuthSession,
  refreshAuthSession,
} from '../../../lib/auth.mjs';

import { parseSessionGetRoute } from '../../session/route-utils.mjs';
import {
  buildFileAssetDirectUrl,
  createFileAssetUploadIntent,
  finalizeFileAssetUpload,
  getFileAsset,
  getFileAssetForClient,
} from '../../file-assets.mjs';
import { isOwnerOnlyRoute } from '../../contracts/system/owner-only-routes.mjs';
import { createSessionAccessGuard } from '../session/access.mjs';
import { handleChatPageRequest } from '../system/chat-page.mjs';
import { handleAssetReadRoutes } from '../assets/read-routes.mjs';
import { handleAssetWriteRoutes } from '../assets/write-routes.mjs';
import { handleHookReadRoutes } from '../hooks/read-routes.mjs';
import { handleHookWriteRoutes } from '../hooks/write-routes.mjs';
import { handleOutputPanelReadRoutes } from '../output-panel/read-routes.mjs';
import { handleRunReadRoutes } from '../run/read-routes.mjs';
import { handleRunWriteRoutes } from '../run/write-routes.mjs';
import { handleSessionCatalogReadRoutes } from '../session/read-catalog-routes.mjs';
import { handleSessionEventReadRoutes } from '../session/read-event-routes.mjs';
import { handleSessionDeleteRoutes } from '../session/delete-routes.mjs';
import { handleSessionPatchRoutes } from '../session/patch-routes.mjs';
import { handleSessionPostRoutes } from '../session/post-routes.mjs';
import { handleSettingsReadRoutes } from '../settings/read-routes.mjs';
import { handleSettingsWriteRoutes } from '../settings/write-routes.mjs';
import { handleSystemReadRoutes } from '../system/read-routes.mjs';
import { handleSystemWriteRoutes } from '../system/write-routes.mjs';
import { handleWorkbenchReadRoutes } from '../workbench/read-routes.mjs';
import { handleWorkbenchWriteRoutes } from '../workbench/write-routes.mjs';
import { buildChatPageBootstrap } from '../../services/system/chat-bootstrap-service.mjs';
import { scheduleConfigReload } from '../../services/system/config-reload-service.mjs';
import { createRouter } from '../../shared/http/router.mjs';

const router = createRouter()
  .use(handleAssetReadRoutes)
  .use(handleAssetWriteRoutes)
  .use(handleSessionCatalogReadRoutes)
  .use(handleSessionEventReadRoutes)
  .use(handleOutputPanelReadRoutes)
  .use(handleWorkbenchReadRoutes)
  .use(handleWorkbenchWriteRoutes)
  .use(handleSettingsReadRoutes)
  .use(handleSettingsWriteRoutes)
  .use(handleSessionPostRoutes)
  .use(handleSessionPatchRoutes)
  .use(handleSessionDeleteRoutes)
  .use(handleRunReadRoutes)
  .use(handleRunWriteRoutes)
  .use(handleHookReadRoutes)
  .use(handleHookWriteRoutes)
  .use(handleSystemReadRoutes)
  .use(handleSystemWriteRoutes)
  .use(handleChatPageRequest);

export async function handleAuthenticatedHttpRoutes({
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
}) {
  const writeJson = createWriteJsonWriter(req);
  const authSession = getAuthSession(req);

  if (authSession?.role !== 'owner' && isOwnerOnlyRoute(pathname, req.method)) {
    writeJson(res, 403, { error: 'Owner access required' });
    return true;
  }

  const ctx = {
    req,
    res,
    pathname,
    pathParts: pathname.split('/').filter(Boolean),
    parsedUrl,
    nonce,
    authSession,
    sessionGetRoute: req.method === 'GET' ? parseSessionGetRoute(pathname) : null,
    writeJson,
    writeJsonCached,
    writeFileCached,
    prepareResponseBody,
    buildHeaders,
    requireSessionAccess: createSessionAccessGuard(writeJson),
    // asset helpers
    getFileAsset,
    getFileAssetForClient,
    buildFileAssetDirectUrl,
    createFileAssetUploadIntent,
    finalizeFileAssetUpload,
    // page helpers
    getAuthSession,
    refreshAuthSession,
    buildChatPageBootstrap,
    // settings helpers
    scheduleConfigReload,
  };

  return router.dispatch(ctx);
}
