import {
  getPageBuildInfo,
  loginTemplatePath,
  readFrontendFileCached,
} from '../../services/system/page-build-service.mjs';
import {
  buildTemplateReplacements,
  renderPageTemplate,
} from '../../views/system/page-template.mjs';

export async function handlePublicPageRoutes({
  req,
  res,
  parsedUrl,
  pathname,
  nonce,
  buildHeaders,
  prepareResponseBody,
  writeJsonCached,
} = {}) {
  if (pathname === '/login') {
    const hasError = parsedUrl?.query?.error === '1';
    const mode = parsedUrl?.query?.mode === 'token' ? 'token' : 'pw';
    let loginHtml;
    const pageBuildInfo = await getPageBuildInfo();
    try {
      loginHtml = await readFrontendFileCached(loginTemplatePath, 'utf8');
    } catch {
      loginHtml = '<h1>Login template missing</h1>';
    }
    const loginResponse = prepareResponseBody(req, {
      contentType: 'text/html; charset=utf-8',
      body: renderPageTemplate(loginHtml, nonce, {
        ...buildTemplateReplacements(pageBuildInfo),
        ERROR_CLASS: hasError ? '' : 'hidden',
        MODE: mode,
      }),
      allowCompression: true,
    });
    res.writeHead(200, buildHeaders({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      ...(loginResponse.vary ? { Vary: loginResponse.vary } : {}),
      ...loginResponse.headers,
    }));
    res.end(loginResponse.body);
    return true;
  }

  if (pathname === '/api/build-info' && req.method === 'GET') {
    const pageBuildInfo = await getPageBuildInfo();
    writeJsonCached(req, res, pageBuildInfo, {
      cacheControl: 'no-store, max-age=0, must-revalidate',
      vary: '',
      headers: {
        'X-MelodySync-Runtime-Mode': pageBuildInfo.runtimeMode,
        'X-MelodySync-Release-Id': pageBuildInfo.releaseId || '',
        'X-MelodySync-Asset-Version': pageBuildInfo.assetVersion,
        'X-MelodySync-Service-Build': pageBuildInfo.serviceTitle,
        'X-MelodySync-Frontend-Build': pageBuildInfo.frontendTitle,
      },
    });
    return true;
  }

  return false;
}
