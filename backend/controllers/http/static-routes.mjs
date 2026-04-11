import {
  readFrontendFileCached,
  resolveStaticAsset,
} from '../../services/system/page-build-service.mjs';

export async function handleStaticHttpRoutes({
  req,
  res,
  pathname,
  query,
  writeFileCached,
  buildHeaders,
}) {
  const staticAsset = await resolveStaticAsset(pathname, query);
  if (!staticAsset) {
    return false;
  }

  try {
    const content = await readFrontendFileCached(staticAsset.filepath);
    writeFileCached(req, res, staticAsset.contentType, content, {
      cacheControl: staticAsset.cacheControl,
    });
  } catch {
    res.writeHead(404, buildHeaders({ 'Content-Type': 'text/plain' }));
    res.end('Not Found');
  }
  return true;
}
