// Centralised JWT secret resolution.
// In production a real secret is mandatory — we refuse to fall back to a
// hardcoded value (which would let anyone forge tokens). In non-production we
// allow a clearly-labelled dev default so local setup stays frictionless.
import type jwt from 'jsonwebtoken';
import { logger } from './logger';

const DEV_FALLBACK_SECRET = 'vesselmind-dev-only-insecure-secret';

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_SECRET is missing or too short (min 32 chars). Refusing to start in production.'
      );
    }
    logger.warn(
      '[SECURITY] JWT_SECRET not set — using an insecure development-only secret. Do not use in production.'
    );
    return DEV_FALLBACK_SECRET;
  }

  return secret;
}

export const JWT_SECRET = resolveJwtSecret();
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// THE CLAIM CONTRACT. Every token this app mints names who issued it (`iss`)
// and who it is for (`aud`), and every gate that accepts one checks both:
// middleware/auth.ts, lib/fleetSockets.ts, and the analytics service
// (data-platform/api/main.py, which must hold the same two strings).
//
// Why bother when one secret signs everything: the secret proves a token came
// from SOMETHING holding it, not that it was meant for this use. Any other token
// signed with the same secret — a future service-to-service token, a reset link,
// a one-off script's test token — would otherwise be a full user session. Naming
// the issuer and audience is what keeps those from being interchangeable.
export const JWT_ISSUER = 'vesselmind-api';
export const JWT_AUDIENCE = 'vesselmind-app';

// THE ANALYTICS TOKEN. The analytics service (data-platform/api/main.py) has no
// connection to Postgres, so it cannot run the live-session check that makes
// revocation work (lib/session.ts). Rather than trust a 7-day login token
// there, it accepts only a short-lived token of its own audience, which this
// backend issues from POST /api/auth/analytics-token AFTER that check passes.
// Revocation therefore reaches analytics within ANALYTICS_TOKEN_TTL_SECONDS,
// with no database or network dependency added to the Python service.
//
// A different audience on purpose: a login token is refused by analytics, and
// an analytics token is refused by every gate here (JWT_VERIFY_OPTIONS names
// JWT_AUDIENCE). Neither can be used as the other.
export const JWT_ANALYTICS_AUDIENCE = 'vesselmind-analytics';
export const ANALYTICS_TOKEN_TTL_SECONDS = 300;

/** Options every verifier passes to jwt.verify. One definition, three callers. */
export const JWT_VERIFY_OPTIONS = {
  algorithms: ['HS256'] as jwt.Algorithm[],
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
};

// Demo credentials are only honoured outside production.
export const DEMO_LOGIN_ENABLED = process.env.NODE_ENV !== 'production';

// The demo account's id: the hardcoded fallback payload in routes/auth.ts and
// the seeded row in prisma/seed.ts both use it. lib/session.ts needs it to
// recognise a demo token on a database that was never seeded.
export const DEMO_USER_ID = 'user-001';
