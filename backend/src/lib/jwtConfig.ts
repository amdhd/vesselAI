// Centralised JWT secret resolution.
// In production a real secret is mandatory — we refuse to fall back to a
// hardcoded value (which would let anyone forge tokens). In non-production we
// allow a clearly-labelled dev default so local setup stays frictionless.
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

// Demo credentials are only honoured outside production.
export const DEMO_LOGIN_ENABLED = process.env.NODE_ENV !== 'production';
