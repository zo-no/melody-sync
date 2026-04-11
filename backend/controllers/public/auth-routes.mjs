import { SESSION_EXPIRY } from '../../../lib/config.mjs';
import {
  clearCookie,
  generateToken,
  parseCookies,
  saveAuthSessionsAsync,
  sessions,
  setCookie,
  verifyPasswordAsync,
  verifyTokenAsync,
} from '../../../lib/auth.mjs';
import { readBody } from '../../../lib/utils.mjs';

import {
  clearFailedAttempts,
  getClientIp,
  isRateLimited,
  recordFailedAttempt,
} from '../../middleware.mjs';

export function buildPostAuthLocation(parsedUrl, pathname = '/') {
  const nextPath = pathname === '/login' ? '/' : (typeof pathname === 'string' && pathname.trim() ? pathname : '/');
  const nextQuery = new URLSearchParams();
  const sourceQuery = parsedUrl?.query && typeof parsedUrl.query === 'object'
    ? parsedUrl.query
    : null;
  if (sourceQuery) {
    for (const [key, value] of Object.entries(sourceQuery)) {
      if (key === 'token') continue;
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (typeof entry === 'string' && entry.length > 0) {
            nextQuery.append(key, entry);
          }
        }
        continue;
      }
      if (typeof value === 'string' && value.length > 0) {
        nextQuery.set(key, value);
      }
    }
  }
  const serialized = nextQuery.toString();
  return serialized ? `${nextPath}?${serialized}` : nextPath;
}

export async function handlePublicAuthRoutes(ctx) {
  const { req, res, parsedUrl, pathname } = ctx;
  const queryToken = parsedUrl?.query?.token;
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
      res.writeHead(302, {
        Location: buildPostAuthLocation(parsedUrl, pathname),
        'Set-Cookie': setCookie(sessionToken),
      });
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

  return false;
}
