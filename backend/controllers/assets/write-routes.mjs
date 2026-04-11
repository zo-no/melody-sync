import { readJsonRequestBody } from '../../shared/http/request-body.mjs';

import { parseFileAssetRoute } from './file-asset-route.mjs';

export async function handleAssetWriteRoutes(ctx) {
  const {
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess,
    createFileAssetUploadIntent,
    getFileAsset,
    finalizeFileAssetUpload,
    writeJson,
  } = ctx;
  const fileAssetRoute = parseFileAssetRoute(pathname);

  if (pathname === '/api/assets/upload-intents' && req?.method === 'POST') {
    let payload = {};
    try {
      payload = await readJsonRequestBody(req, 32768);
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }

    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : '';
    if (!requireSessionAccess(res, authSession, sessionId)) return true;

    try {
      const intent = await createFileAssetUploadIntent({
        sessionId,
        originalName: payload?.originalName,
        mimeType: payload?.mimeType,
        sizeBytes: payload?.sizeBytes,
        createdBy: authSession?.role || 'owner',
      });
      writeJson(res, 200, intent);
    } catch (error) {
      writeJson(res, error?.statusCode || 400, {
        error: error?.message || 'Failed to create file asset upload intent',
      });
    }
    return true;
  }

  if (fileAssetRoute?.action === 'finalize' && req?.method === 'POST') {
    const asset = await getFileAsset(fileAssetRoute.assetId);
    if (!asset) {
      writeJson(res, 404, { error: 'Asset not found' });
      return true;
    }
    if (!requireSessionAccess(res, authSession, asset.sessionId)) return true;

    let payload = {};
    try {
      payload = await readJsonRequestBody(req, 32768);
    } catch {
      writeJson(res, 400, { error: 'Invalid request body' });
      return true;
    }

    try {
      const next = await finalizeFileAssetUpload(fileAssetRoute.assetId, {
        sizeBytes: payload?.sizeBytes,
        etag: typeof payload?.etag === 'string' ? payload.etag : '',
      });
      writeJson(res, 200, { asset: next });
    } catch (error) {
      writeJson(res, error?.statusCode || 400, { error: error.message || 'Failed to finalize asset upload' });
    }
    return true;
  }

  return false;
}
