import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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

  // Allow demo tokens (frontend fallback when backend was unreachable at login time)
  if (token.startsWith('demo_token_')) {
    req.user = {
      id: 'user-001',
      email: 'demo@petronas.com',
      role: 'fleet_manager',
      fleetId: 'fleet-001',
      name: 'Captain Ahmad Fauzi',
    };
    next();
    return;
  }

  const secret = process.env.JWT_SECRET || 'vesselmind-secret-key-change-in-production';

  try {
    const decoded = jwt.verify(token, secret) as JwtPayload;
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
