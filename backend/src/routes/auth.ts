import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../lib/logger';
import { validate } from '../middleware/validate';
import { LoginSchema, RegisterSchema } from '../schemas';
import { JWT_SECRET, JWT_EXPIRES_IN, DEMO_LOGIN_ENABLED } from '../lib/jwtConfig';

const router = Router();

// Roles a self-service registrant is permitted to request. Privileged roles
// (e.g. admin) must never be assignable from a public signup payload.
const SELF_REGISTER_ROLES = new Set(['fleet_manager', 'engineer', 'viewer']);

function generateToken(user: { id: string; email: string; role: string; fleetId?: string | null; name: string }): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      fleetId: user.fleetId,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN } as SignOptions
  );
}

// The demo account is honoured on two paths — DB unreachable, and DB reachable
// but unseeded — so keep the credential check and canned payload in one place.
const DEMO_USER = {
  id: 'user-001',
  email: 'demo@petronas.com',
  name: 'Captain Ahmad Fauzi',
  role: 'fleet_manager',
  fleetId: 'fleet-001',
} as const;

// If the request carries valid demo credentials (and demo login is enabled),
// write the token response and return true so the caller can stop. Returns
// false otherwise, leaving the response untouched.
function tryDemoLogin(email: string, password: string, res: Response): boolean {
  if (!DEMO_LOGIN_ENABLED || email !== DEMO_USER.email || password !== 'demo123') {
    return false;
  }
  res.json({ token: generateToken(DEMO_USER), user: DEMO_USER });
  return true;
}

// POST /api/auth/login
router.post('/login', validate(LoginSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Try to find user in DB first
    let user: { id: string; email: string; password: string; name: string; role: string; fleetId: string | null } | null = null;

    try {
      user = await prisma.user.findUnique({ where: { email } });
    } catch {
      // DB not connected — use demo fallback (non-production only)
      if (tryDemoLogin(email, password, res)) return;
      res.status(503).json({ error: 'Database unavailable. Use demo@petronas.com / demo123' });
      return;
    }

    if (!user) {
      // DB connected but not seeded — still allow demo credentials (non-production only)
      if (tryDemoLogin(email, password, res)) return;
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = generateToken(user);
    const { password: _password, ...userWithoutPassword } = user;

    res.json({
      token,
      user: userWithoutPassword,
    });
  } catch (error) {
    logger.error({ err: error }, 'Login error');
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// POST /api/auth/register
router.post('/register', validate(RegisterSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name, role } = req.body;

    let existingUser: { id: string } | null = null;
    try {
      existingUser = await prisma.user.findUnique({ where: { email } });
    } catch {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }

    if (existingUser) {
      res.status(409).json({ error: 'User with this email already exists' });
      return;
    }

    // Never trust a client-supplied privileged role. Only allow-listed,
    // non-privileged roles may be self-assigned; everything else defaults.
    const safeRole = SELF_REGISTER_ROLES.has(role) ? role : 'fleet_manager';

    const hashedPassword = await bcrypt.hash(password, 12);

    // New accounts start with no fleet. Fleet membership — which grants access
    // to that fleet's vessels — is assigned later through a trusted admin/invite
    // flow, never from the self-service signup payload.
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: safeRole,
        fleetId: null,
      },
    });

    const token = generateToken(user);
    const { password: _password, ...userWithoutPassword } = user;

    res.status(201).json({
      token,
      user: userWithoutPassword,
    });
  } catch (error) {
    logger.error({ err: error }, 'Register error');
    res.status(500).json({ error: 'Registration failed' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    let user: { id: string; email: string; name: string; role: string; fleetId: string | null; createdAt: Date; updatedAt: Date } | null = null;

    try {
      user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          fleetId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch {
      // Return from token payload if DB unavailable
      res.json({
        user: {
          id: req.user.id,
          email: req.user.email,
          name: req.user.name,
          role: req.user.role,
          fleetId: req.user.fleetId,
        },
      });
      return;
    }

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user });
  } catch (error) {
    logger.error({ err: error }, 'Get me error');
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;
