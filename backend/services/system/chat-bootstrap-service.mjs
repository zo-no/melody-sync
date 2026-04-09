import { getFileAssetBootstrapConfig } from '../../file-assets.mjs';
import { createWorkbenchNodeDefinitionsPayload } from '../../workbench/node-definitions.mjs';
import { buildAuthInfo } from '../../views/system/auth.mjs';

const CHAT_SHARED_BOOTSTRAP_CACHE_TTL_MS = 1000;

let cachedChatPageSharedBootstrap = null;

export function resetChatPageBootstrapCache() {
  cachedChatPageSharedBootstrap = null;
}

export function buildChatPageBootstrap(authSession) {
  const now = Date.now();
  if (
    !cachedChatPageSharedBootstrap
    || now - cachedChatPageSharedBootstrap.cachedAt >= CHAT_SHARED_BOOTSTRAP_CACHE_TTL_MS
  ) {
    cachedChatPageSharedBootstrap = {
      cachedAt: now,
      payload: {
        assetUploads: getFileAssetBootstrapConfig(),
        workbench: createWorkbenchNodeDefinitionsPayload(),
      },
    };
  }

  return {
    auth: buildAuthInfo(authSession),
    ...cachedChatPageSharedBootstrap.payload,
  };
}
