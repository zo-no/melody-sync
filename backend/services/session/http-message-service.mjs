import { basename } from 'path';

import { resolveSavedAttachments, saveAttachments } from './attachment-storage-service.mjs';

import { pathExists } from '../../fs-utils.mjs';
import { getFileAsset } from '../../file-assets.mjs';
import {
  sendMessage,
  submitHttpMessage,
} from '../../session/manager.mjs';

function createHttpError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function getRequestId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function resolveExternalAssetImages(requestedImages, authSession, hasSessionAccess) {
  const externalAssetImages = [];
  for (const image of requestedImages) {
    const assetId = typeof image?.assetId === 'string' ? image.assetId.trim() : '';
    if (!assetId) continue;
    const asset = await getFileAsset(assetId);
    if (!asset) {
      throw createHttpError(`Unknown asset: ${assetId}`, 400);
    }
    if (!hasSessionAccess?.(authSession, asset.sessionId)) {
      throw createHttpError('Access denied', 403);
    }
    if (asset.status !== 'ready') {
      throw createHttpError(`Asset is not ready: ${assetId}`, 409);
    }
    const localizedPath = typeof asset.localizedPath === 'string' && asset.localizedPath && await pathExists(asset.localizedPath)
      ? asset.localizedPath
      : '';
    externalAssetImages.push({
      assetId: asset.id,
      ...(localizedPath ? {
        savedPath: localizedPath,
        filename: typeof image?.filename === 'string' && image.filename.trim()
          ? image.filename.trim()
          : basename(localizedPath),
      } : {}),
      originalName: typeof image?.originalName === 'string' && image.originalName.trim()
        ? image.originalName.trim()
        : asset.originalName,
      mimeType: typeof image?.mimeType === 'string' && image.mimeType.trim()
        ? image.mimeType.trim()
        : asset.mimeType,
    });
  }
  return externalAssetImages;
}

export async function submitSessionHttpMessageForClient({
  sessionId,
  payload,
  authSession,
  hasSessionAccess,
} = {}) {
  const requestId = getRequestId(payload?.requestId);
  const requestedImages = Array.isArray(payload?.images) ? payload.images.filter(Boolean) : [];
  const uploadedImages = requestedImages.filter((image) => Buffer.isBuffer(image?.buffer) || typeof image?.data === 'string');
  const existingImages = requestedImages.filter((image) => typeof image?.filename === 'string' && image.filename.trim() && !image?.assetId);
  const externalAssetImages = await resolveExternalAssetImages(requestedImages, authSession, hasSessionAccess);
  const preSavedAttachments = [
    ...(await resolveSavedAttachments(existingImages)),
    ...(uploadedImages.length > 0 ? await saveAttachments(uploadedImages) : []),
    ...externalAssetImages,
  ];
  const messageOptions = {
    tool: payload.tool || undefined,
    thinking: !!payload.thinking,
    model: payload.model || undefined,
    effort: payload.effort || undefined,
    sourceContext: payload.sourceContext,
    ...(preSavedAttachments.length > 0 ? { preSavedAttachments } : {}),
  };
  const outcome = requestId
    ? await submitHttpMessage(sessionId, payload.text.trim(), [], {
        ...messageOptions,
        requestId,
      })
    : await sendMessage(sessionId, payload.text.trim(), [], messageOptions);
  return {
    requestId,
    outcome,
  };
}
