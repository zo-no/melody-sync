import { parseFileAssetRoute } from './file-asset-route.mjs';

export async function handleAssetReadRoutes(ctx) {
  const {
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess,
    getFileAsset,
    getFileAssetForClient,
    buildFileAssetDirectUrl,
    writeJson,
    buildHeaders,
  } = ctx;
  const fileAssetRoute = parseFileAssetRoute(pathname);

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
