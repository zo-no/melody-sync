function parseFileAssetRoute(pathname) {
  const match = /^\/api\/assets\/(fasset_[a-f0-9]{24})(?:\/(download|finalize))?$/.exec(pathname || '');
  if (!match) return null;
  return {
    assetId: match[1],
    action: match[2] || null,
  };
}

export async function handleAssetRoutes({
  req,
  res,
  pathname,
  authSession,
  requireSessionAccess,
  createFileAssetUploadIntent,
  getFileAsset,
  getFileAssetForClient,
  finalizeFileAssetUpload,
  buildFileAssetDirectUrl,
  readBody,
  writeJson,
  buildHeaders,
} = {}) {
  const fileAssetRoute = parseFileAssetRoute(pathname);

  if (pathname === '/api/assets/upload-intents' && req?.method === 'POST') {
    let payload = {};
    try {
      const body = await readBody(req, 32768);
      payload = body ? JSON.parse(body) : {};
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

  if (fileAssetRoute && req?.method === 'GET' && !fileAssetRoute.action) {
    const asset = await getFileAsset(fileAssetRoute.assetId);
    if (!asset) {
      writeJson(res, 404, { error: 'Asset not found' });
      return true;
    }
    if (!requireSessionAccess(res, authSession, asset.sessionId)) return true;
    const clientAsset = await getFileAssetForClient(asset.id, {
      includeDirectUrl: asset.status === 'ready',
    });
    writeJson(res, 200, { asset: clientAsset });
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
      const body = await readBody(req, 32768);
      payload = body ? JSON.parse(body) : {};
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

  if (fileAssetRoute?.action === 'download' && req?.method === 'GET') {
    const asset = await getFileAsset(fileAssetRoute.assetId);
    if (!asset) {
      writeJson(res, 404, { error: 'Asset not found' });
      return true;
    }
    if (!requireSessionAccess(res, authSession, asset.sessionId)) return true;

    try {
      const direct = await buildFileAssetDirectUrl(asset);
      res.writeHead(302, buildHeaders({
        Location: direct.url,
        'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
      }));
      res.end();
    } catch (error) {
      writeJson(res, error?.statusCode || 400, { error: error.message || 'Failed to build asset download link' });
    }
    return true;
  }

  return false;
}
