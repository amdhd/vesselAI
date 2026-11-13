import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../lib/logger';
import { recordAudit } from '../lib/audit';
import { revokeSessions } from '../lib/session';
import { isProduction } from '../config/env';
import { validate } from '../middleware/validate';
import { LoginSchema, RegisterSchema } from '../schemas';
import {
  JWT_SECRET, JWT_EXPIRES_IN, JWT_ISSUER, JWT_AUDIENCE, JWT_ANALYTICS_AUDIENCE,
  ANALYTICS_TOKEN_TTL_SECONDS, DEMO_LOGIN_ENABLED, DEMO_USER_ID,
} from '../lib/jwtConfig';

const router = Router();

// Roles a self-service registrant is permitted to request. Privileged roles
// (e.g. admin) must never be assignable from a public signup payload.
const SELF_REGISTER_ROLES = new Set(['fleet_manager', 'engineer', 'viewer']);

// What an unknown email's password is compared against, so login costs the
// same whether or not the account exists. A real bcrypt hash of random bytes
// nobody kept. It must use the SAME cost factor as stored passwords (12, in
// /register below and prisma/seed.ts), or the two paths still differ in time;
// the authTiming test checks that. Precomputed rather than hashed at startup so
// it adds nothing to boot time.
export const TIMING_EQUALISER_HASH = '$2a$12$DnX6R4fdsMxEDF3saPlulu6CrJD9iG.rCg8l00kQnnQtx0om/GMKy';

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
    // issuer/audience: the claim contract every gate verifies (lib/jwtConfig.ts).
    { expiresIn: JWT_EXPIRES_IN, issuer: JWT_ISSUER, audience: JWT_AUDIENCE } as SignOptions
  );
}

// The demo account is honoured on two paths — DB unreachable, and DB reachable
// but unseeded — so keep the credential check and canned payload in one place.
const DEMO_USER = {
  id: DEMO_USER_ID,
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
      // Pay for a bcrypt compare even though there is nothing to compare
      // against. Without it, an unknown email is rejected in about a
      // millisecond while a known email with a wrong password takes a full
      // cost-12 compare. The 401 text was already identical, but the timing
      // answered "does this email have an account?" for anyone who measured it.
      // The result is ignored, so the request stays a 401 whatever the password.
      await bcrypt.compare(password, TIMING_EQUALISER_HASH);
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

    // The account being created is its own actor, so it is its own audit subject.
    // No email in details: the row already identifies the account by id, and the
    // trail should not accumulate more personal data than it needs.
    await recordAudit({
      userId: user.id,
      entity: 'User',
      action: 'create',
      entityId: user.id,
      details: { role: safeRole },
    });

    res.status(201).json({
      token,
      user: userWithoutPassword,
    });
  } catch (error) {
    logger.error({ err: error }, 'Register error');
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/analytics-token
//
// Exchange a login token for a short-lived token the analytics service accepts.
// See JWT_ANALYTICS_AUDIENCE in lib/jwtConfig.ts for why analytics does not take
// the login token itself. `authenticate` has already run the live-session check,
// so the role and fleet signed in here are the current ones, and a revoked or
// deleted account cannot obtain one.
router.post('/analytics-token', authenticate, (req: AuthenticatedRequest, res: Response): void => {
  const user = req.user!;
  // The analytics gate refuses a token with no fleet; refuse here first, so the
  // client gets a clear 403 instead of a token that can never be used.
  if (!user.fleetId) {
    res.status(403).json({ error: 'Analytics requires a fleet assignment' });
    return;
  }
  const token = jwt.sign(
    { id: user.id, role: user.role, fleetId: user.fleetId },
    JWT_SECRET,
    { expiresIn: ANALYTICS_TOKEN_TTL_SECONDS, issuer: JWT_ISSUER, audience: JWT_ANALYTICS_AUDIENCE }
  );
  res.json({ token, expiresIn: ANALYTICS_TOKEN_TTL_SECONDS });
});

// POST /api/auth/logout-all
//
// Sign out everywhere: every token this account holds stops working, on every
// device, including the one that sent this request. The client should discard
// its token afterwards. Tokens issued from now on (a fresh login) are fine.
//
// There is no single-device logout on the server: without a per-token id
// there is nothing to revoke one token by. The app's ordinary logout clears
// the token client-side, as before.
router.post('/logout-all', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;
  try {
    await revokeSessions(userId);
  } catch (error) {
    // Includes the no-database demo mode, where there is no row to stamp.
    logger.error({ err: error }, 'Revoke sessions failed');
    res.status(503).json({ error: 'Database unavailable' });
    return;
  }
  await recordAudit({ userId, entity: 'User', action: 'revoke_sessions', entityId: userId });
  res.status(204).end();
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
      // Database unreachable. This endpoint is the user's RECORD, so it must not
      // pass anything else off as one.
      //
      // Production: 503. The auth gate refuses outright while the database is
      // down (lib/session.ts); the only way to get here is a session check
      // served from the 30s cache just before the outage. Returning that cache
      // as the account record, unmarked, is what this used to do.
      if (isProduction) {
        res.status(503).json({ error: 'Database unavailable' });
        return;
      }
      // Outside production the app is built to run with no database (demo
      // mode), so answer, but say plainly that this came from the token, not
      // the database. A client must not treat it as authoritative.
      res.setHeader('X-Data-Source', 'token');
      res.json({
        user: {
          id: req.user.id,
          email: req.user.email,
          name: req.user.name,
          role: req.user.role,
          fleetId: req.user.fleetId,
        },
        degraded: true,
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
