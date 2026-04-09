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

export async function handlePublicAuthRoutes({
  req,
  res,
  parsedUrl,
  pathname,
} = {}) {
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
