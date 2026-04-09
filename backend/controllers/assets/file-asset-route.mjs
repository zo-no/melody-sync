export function parseFileAssetRoute(pathname) {
  const match = /^\/api\/assets\/(fasset_[a-f0-9]{24})(?:\/(download|finalize))?$/.exec(pathname || '');
  if (!match) return null;
  return {
    assetId: match[1],
    action: match[2] || null,
  };
}
