import { readFile } from 'fs/promises';
import { SESSION_EXPIRY } from '../lib/config.mjs';
import {
  sessions,
  saveAuthSessionsAsync,
  verifyTokenAsync,
  verifyPasswordAsync,
  generateToken,
  parseCookies,
  setCookie,
  clearCookie,
} from '../lib/auth.mjs';
import { readBody } from '../lib/utils.mjs';
import {
  getClientIp,
  isRateLimited,
  recordFailedAttempt,
  clearFailedAttempts,
} from './middleware.mjs';

export async function handlePublicRoutes({
  req,
  res,
  parsedUrl,
  pathname,
  nonce,
  loginTemplatePath,
  readFrontendFileCached,
  getPageBuildInfo,
  buildHeaders,
  prepareResponseBody,
  renderPageTemplate,
  buildTemplateReplacements,
  writeJsonCached,
}) {
  const queryToken = parsedUrl.query.token;
  if (queryToken) {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '60' });
      res.end('Too many failed attempts. Please try again later.');
      return true;
    }
    if (await verifyTokenAsync(queryToken)) {
      clearFailedAttempts(ip);
      const sessionToken = generateToken();
      sessions.set(sessionToken, { expiry: Date.now() + SESSION_EXPIRY });
      await saveAuthSessionsAsync();
      res.writeHead(302, { Location: '/', 'Set-Cookie': setCookie(sessionToken) });
      res.end();
    } else {
      recordFailedAttempt(ip);
      res.writeHead(302, { Location: '/login' });
      res.end();
    }
    return true;
  }

  if (pathname === '/login' && req.method === 'POST') {
    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
      res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '60' });
      res.end('Too many failed attempts. Please try again later.');
      return true;
    }
    let body;
    try {
      body = await readBody(req, 4096);
    } catch {
      body = '';
    }
    const params = new URLSearchParams(body);
    const type = params.get('type');
    let valid = false;
    if (type === 'token') {
      valid = await verifyTokenAsync(params.get('token') || '');
    } else if (type === 'password') {
      valid = await verifyPasswordAsync(params.get('username') || '', params.get('password') || '');
    }
    if (valid) {
      clearFailedAttempts(ip);
      const sessionToken = generateToken();
      sessions.set(sessionToken, { expiry: Date.now() + SESSION_EXPIRY });
      await saveAuthSessionsAsync();
      res.writeHead(302, { Location: '/', 'Set-Cookie': setCookie(sessionToken) });
    } else {
      recordFailedAttempt(ip);
      const mode = type === 'password' ? 'pw' : 'token';
      res.writeHead(302, { Location: `/login?error=1&mode=${mode}` });
    }
    res.end();
    return true;
  }

  if (pathname === '/login') {
    const hasError = parsedUrl.query.error === '1';
    const mode = parsedUrl.query.mode === 'token' ? 'token' : 'pw';
    let loginHtml;
    const pageBuildInfo = await getPageBuildInfo();
    try {
      loginHtml = readFrontendFileCached
        ? await readFrontendFileCached(loginTemplatePath, 'utf8')
        : await readFile(loginTemplatePath, 'utf8');
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

  if (pathname === '/logout') {
    const cookies = parseCookies(req.headers.cookie || '');
    const ownerToken = cookies.session_token;
    if (ownerToken) {
      sessions.delete(ownerToken);
      await saveAuthSessionsAsync();
    }
    res.writeHead(302, {
      Location: '/login',
      'Set-Cookie': clearCookie(),
    });
    res.end();
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
