// The browser session cookie, and the header that marks the first-party web app.
//
// WHY A COOKIE. The React app used to keep its login token in localStorage, where
// any script running on the page can read it. One XSS bug anywhere in the app
// would hand out a working login token. An httpOnly cookie cannot be read by
// script at all: the browser attaches it to requests, but JavaScript never sees
// the value.
//
// WHY A HEADER TOO. A cookie the browser attaches by itself is what makes
// cross-site request forgery possible: another site can make the browser send
// a request that carries it. Two defences, layered:
//   - SameSite=Strict: browsers do not attach the cookie to requests that start
//     on another site.
//   - WEB_CLIENT_HEADER: the web app sends it on every request. A page on another
//     origin cannot add a custom header without a CORS preflight, and CORS here
//     admits only FRONTEND_URL (app.ts), so a forged request cannot carry it.
//     State-changing requests authenticated by the cookie must have it
//     (middleware/auth.ts).
//
// The header also decides whether login ISSUES a cookie at all. Only a request
// that carries it gets one, and the token is then left out of the JSON body.
// Clients without it (the Angular app, API clients, tests) get the token in the
// body as before. That also stops login CSRF: a cross-site form posting someone
// else's credentials cannot send the header, so no cookie is ever set from it.
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { isProduction } from '../config/env';

export const SESSION_COOKIE = 'vm_session';
export const WEB_CLIENT_HEADER = 'x-vesselmind-client';
export const WEB_CLIENT_VALUE = 'web';

/** True when the request comes from the first-party web app. */
export function isWebClient(req: Request): boolean {
  return req.headers[WEB_CLIENT_HEADER] === WEB_CLIENT_VALUE;
}

const cookieOptions = () => ({
  httpOnly: true,
  // HTTPS-only in production. Local development runs over plain http, where a
  // Secure cookie would never be sent back.
  secure: isProduction,
  sameSite: 'strict' as const,
  // '/', not '/api': the browser should present it to this backend wherever it
  // is mounted. nginx strips it from requests forwarded to the analytics
  // service, which has no use for it (frontend/nginx.conf).
  path: '/',
});

/** Set the session cookie, expiring with the token itself. */
export function setSessionCookie(res: Response, token: string): void {
  const exp = (jwt.decode(token) as jwt.JwtPayload | null)?.exp;
  const maxAge = typeof exp === 'number' ? Math.max(0, exp * 1000 - Date.now()) : undefined;
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/**
 * The session cookie's value, if the request has one. Parsed by hand rather
 * than adding cookie-parser for a single read.
 */
export function readSessionCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
