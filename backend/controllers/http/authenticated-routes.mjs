import {
  getAuthSession,
  refreshAuthSession,
} from '../../../lib/auth.mjs';

import { parseSessionGetRoute } from '../../session/route-utils.mjs';
import { buildFileAssetDirectUrl, createFileAssetUploadIntent, finalizeFileAssetUpload, getFileAsset, getFileAssetForClient } from '../../file-assets.mjs';
import { isOwnerOnlyRoute } from '../../contracts/system/owner-only-routes.mjs';
import { createSessionAccessGuard } from '../session/access.mjs';
import { handleChatPageRequest } from '../system/chat-page.mjs';
import { handleAssetRoutes } from '../../routes/assets.mjs';
import { handleHooksRoutes } from '../../routes/hooks.mjs';
import { handleRunRoutes } from '../../routes/runs.mjs';
import { handleSessionReadRoutes } from '../../routes/session-read.mjs';
import { handleSessionWriteRoutes } from '../../routes/session-write.mjs';
import { handleSettingsRoutes } from '../../routes/settings.mjs';
import { handleSystemRoutes } from '../../routes/system.mjs';
import { handleWorkbenchRoutes } from '../../routes/workbench.mjs';
import { buildChatPageBootstrap } from '../../services/system/chat-bootstrap-service.mjs';
import { scheduleConfigReload } from '../../services/system/config-reload-service.mjs';

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
} = {}) {
  const writeJsonForReq = createWriteJsonWriter(req);
  const requireSessionAccessForReq = createSessionAccessGuard(writeJsonForReq);
  const authSession = getAuthSession(req);
  if (authSession?.role !== 'owner' && isOwnerOnlyRoute(pathname, req.method)) {
    writeJsonForReq(res, 403, { error: 'Owner access required' });
    return true;
  }

  const sessionGetRoute = req.method === 'GET' ? parseSessionGetRoute(pathname) : null;

  if (await handleAssetRoutes({
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess: requireSessionAccessForReq,
    createFileAssetUploadIntent,
    getFileAsset,
    getFileAssetForClient,
    finalizeFileAssetUpload,
    buildFileAssetDirectUrl,
    writeJson: writeJsonForReq,
    buildHeaders,
  })) {
    return true;
  }

  if (await handleSessionReadRoutes({
    req,
    res,
    parsedUrl,
    sessionGetRoute,
    authSession,
    requireSessionAccess: requireSessionAccessForReq,
    writeJsonCached,
    writeJson: writeJsonForReq,
  })) {
    return true;
  }

  if (await handleWorkbenchRoutes({
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess: requireSessionAccessForReq,
    writeJson: writeJsonForReq,
  })) {
    return true;
  }

  if (await handleSettingsRoutes({
    req,
    res,
    pathname,
    writeJson: writeJsonForReq,
    scheduleConfigReload,
  })) {
    return true;
  }

  if (await handleSessionWriteRoutes({
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess: requireSessionAccessForReq,
    writeJson: writeJsonForReq,
  })) {
    return true;
  }

  if (await handleRunRoutes({
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess: requireSessionAccessForReq,
    writeJsonCached,
    writeJson: writeJsonForReq,
  })) {
    return true;
  }

  if (await handleHooksRoutes({ req, res, pathname, writeJson: writeJsonForReq })) {
    return true;
  }

  if (await handleSystemRoutes({
    req,
    res,
    pathname,
    parsedUrl,
    writeJson: writeJsonForReq,
    writeJsonCached,
    writeFileCached,
  })) {
    return true;
  }

  if (await handleChatPageRequest({
    req,
    res,
    pathname,
    nonce,
    getAuthSession,
    refreshAuthSession,
    buildChatPageBootstrap,
    prepareResponseBody,
    buildHeaders,
  })) {
    return true;
  }

  return false;
}
