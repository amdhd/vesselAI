import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_VERIFY_OPTIONS } from '../lib/jwtConfig';
import { authorizeClaims, type Authorization } from '../lib/session';
import { isWebClient, readSessionCookie } from '../lib/sessionCookie';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    fleetId?: string | null;
    name: string;
  };
}

interface JwtPayload {
  id: string;
  email: string;
  role: string;
  fleetId?: string | null;
  name: string;
}

/**
 * Two questions, in order:
 *   1. Is this a token the app minted? (signature, algorithm, expiry, claim
 *      contract) Answered from the token alone.
 *   2. Is it still a valid session, and with what role and fleet? Answered
 *      from the database by lib/session.ts, because a token is a snapshot
 *      from login. role and fleetId on req.user are the LIVE values, so a
 *      demotion, a fleet change, a deleted account or a "sign out everywhere"
 *      takes effect within the session cache window, not when the token
 *      happens to expire.
 */
export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // WHERE THE TOKEN COMES FROM. A bearer header wins whenever one is present
  // (the Angular app, API clients, tests). Otherwise the web app's httpOnly
  // session cookie (lib/sessionCookie.ts). An invalid header token is refused;
  // it never falls back to the cookie, so a request means one credential.
  const authHeader = req.headers.authorization;
  let token: string | undefined;
  if (authHeader) {
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }
    token = authHeader.split(' ')[1];
  } else {
    token = readSessionCookie(req);
    // CSRF: the cookie is attached by the browser, so a request riding on it
    // could have been started by another site. A state-changing one must also
    // carry the web app's header, which another origin cannot add. Reads are
    // exempt: they change nothing, and CORS stops another site reading the
    // answer.
    if (token && !SAFE_METHODS.has(req.method) && !isWebClient(req)) {
      res.status(403).json({ error: 'Missing client header' });
      return;
    }
  }

  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  let decoded: JwtPayload & { exp?: unknown; iat?: number };
  try {
    // Pin the algorithm: tokens are HMAC-signed (jwtConfig uses a symmetric
    // secret), so only HS256 is ever valid. Restricting the accepted set is
    // defence-in-depth against algorithm-confusion tricks. Issuer and audience
    // are checked too: the shared claim contract in lib/jwtConfig.ts.
    decoded = jwt.verify(token, JWT_SECRET, JWT_VERIFY_OPTIONS) as typeof decoded;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
    } else if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
    } else {
      res.status(500).json({ error: 'Authentication error' });
    }
    return;
  }

  // jsonwebtoken enforces `exp` only when the token HAS one — a token signed
  // without it verifies, and is valid forever. generateToken always sets it,
  // so a token without one was not minted by this app's login path.
  if (typeof decoded.exp !== 'number' || !Number.isFinite(decoded.exp)) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  // Express 4 does not catch a rejected promise from async middleware: an
  // unexpected throw here would leave the request hanging. authorizeClaims
  // reports a database outage as a result rather than throwing, so this catch
  // is only for the unexpected.
  let auth: Authorization;
  try {
    auth = await authorizeClaims(decoded);
  } catch {
    res.status(500).json({ error: 'Authentication error' });
    return;
  }
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  req.user = auth.user;
  // Outside every try: an error thrown by a downstream handler must reach the
  // central error handler, not be reported as an authentication failure.
  next();
};

export const requireRole = (roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
};
