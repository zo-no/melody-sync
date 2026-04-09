import {
  chatTemplatePath,
  getPageBuildInfo,
  readFrontendFileCached,
} from '../../services/system/page-build-service.mjs';
import {
  renderPageTemplate,
  buildTemplateReplacements,
  serializeJsonForScript,
} from '../../views/system/page-template.mjs';

export async function handleChatPageRequest({
  req,
  res,
  pathname,
  nonce,
  getAuthSession,
  refreshAuthSession,
  buildChatPageBootstrap,
  prepareResponseBody,
  buildHeaders,
} = {}) {
  if (pathname !== '/') return false;

  try {
    const authSession = getAuthSession(req);
    const pageBootstrap = buildChatPageBootstrap(authSession);
    const [pageBuildInfo, chatPage, refreshedCookie] = await Promise.all([
      getPageBuildInfo(),
      readFrontendFileCached(chatTemplatePath, 'utf8'),
      refreshAuthSession(req),
    ]);
    const pageResponse = prepareResponseBody(req, {
      contentType: 'text/html; charset=utf-8',
      body: renderPageTemplate(chatPage, nonce, {
        ...buildTemplateReplacements(pageBuildInfo),
        BOOTSTRAP_JSON: serializeJsonForScript(pageBootstrap),
      }),
      allowCompression: true,
    });
    res.writeHead(200, buildHeaders({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      ...(pageResponse.vary ? { Vary: pageResponse.vary } : {}),
      ...pageResponse.headers,
      ...(refreshedCookie ? { 'Set-Cookie': refreshedCookie } : {}),
    }));
    res.end(pageResponse.body);
  } catch {
    res.writeHead(500, buildHeaders({ 'Content-Type': 'text/plain' }));
    res.end('Failed to load chat page');
  }
  return true;
}
