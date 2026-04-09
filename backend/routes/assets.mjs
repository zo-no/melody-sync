import { handleAssetReadRoutes } from '../controllers/assets/read-routes.mjs';
import { handleAssetWriteRoutes } from '../controllers/assets/write-routes.mjs';

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
  writeJson,
  buildHeaders,
} = {}) {
  if (await handleAssetReadRoutes({
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
  })) return true;

  if (await handleAssetWriteRoutes({
    req,
    res,
    pathname,
    authSession,
    requireSessionAccess,
    createFileAssetUploadIntent,
    getFileAsset,
    finalizeFileAssetUpload,
    writeJson,
  })) return true;

  return false;
}
