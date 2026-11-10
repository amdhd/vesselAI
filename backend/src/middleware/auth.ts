import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_VERIFY_OPTIONS } from '../lib/jwtConfig';

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

export const authenticate = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    // Pin the algorithm: tokens are HMAC-signed (jwtConfig uses a symmetric
    // secret), so only HS256 is ever valid. Restricting the accepted set is
    // defence-in-depth against algorithm-confusion tricks. Issuer and audience
    // are checked too: the shared claim contract in lib/jwtConfig.ts.
    const decoded = jwt.verify(token, JWT_SECRET, JWT_VERIFY_OPTIONS) as JwtPayload & { exp?: unknown };
    // jsonwebtoken enforces `exp` only when the token HAS one — a token signed
    // without it verifies, and is valid forever. generateToken always sets it,
    // so a token without one was not minted by this app's login path. The
    // socket gate (lib/fleetSockets.ts) already refuses these; this brings the
    // REST gate to the same rule.
    if (typeof decoded.exp !== 'number' || !Number.isFinite(decoded.exp)) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      fleetId: decoded.fleetId,
      name: decoded.name,
    };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
    } else if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
    } else {
      res.status(500).json({ error: 'Authentication error' });
    }
  }
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
