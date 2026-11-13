import { createHash } from 'crypto';
import rateLimit, { ipKeyGenerator, MemoryStore, type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { AuthenticatedRequest } from './auth';
import { env, isProduction } from '../config/env';
import { FallbackStore } from '../lib/fallbackStore';
import { getRedisClient } from '../lib/redis';
import { logger } from '../lib/logger';

// WHERE THE COUNTS LIVE. With REDIS_URL set, every limiter counts in Redis, so
// all API replicas share one counter per client and the configured ceilings are
// the real ones. Before this, each replica counted on its own: with the HPA at
// 2–8 replicas, 5 failed logins per 15 minutes was really 10–40, and the limits
// got looser exactly as load scaled the deployment out.
//
// If Redis is unreachable, FallbackStore counts per pod until it is back:
// limits degrade to what they were before, never to none, and a Redis outage
// never blocks a login. Without REDIS_URL (local dev, a single replica) the
// limiters use the per-pod memory store directly.
//
// Each limiter needs its OWN store instance (express-rate-limit refuses to share
// one), with its own key prefix so their counters cannot collide in Redis.
function storeFor(name: string): Store | undefined {
  const redis = getRedisClient();
  if (!redis) return undefined; // express-rate-limit's default MemoryStore
  return new FallbackStore(
    new RedisStore({
      prefix: `rl:${name}:`,
      sendCommand: (...args: string[]) => redis.sendCommand(args),
    }),
    new MemoryStore(),
    { name }
  );
}

if (isProduction && !env.REDIS_URL) {
  logger.warn(
    'REDIS_URL is not set: rate limits are counted per replica, so each ceiling is multiplied by the replica count'
  );
}

// General API — broad abuse protection.
//
// Window and ceiling come from the environment (defaults unchanged: 200 per 15
// minutes) so they can be tuned per deployment without a code change. Two real
// cases: a load test needs them raised, and any deployment where many users
// share an egress IP needs them raised.
//
// NOTE: this limiter counts per IP, which means it is only correct if the app
// can SEE the client's IP. Behind a proxy or Ingress that requires TRUST_PROXY
// to be set — otherwise every request appears to come from the proxy and the
// entire user base shares one bucket. See app.ts.
export const apiLimiter = rateLimit({
  windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  max: env.API_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  store: storeFor('api'),
});

// Auth endpoints — brute force protection
// skipSuccessfulRequests: only failed logins count toward the limit
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again in 15 minutes' },
  skipSuccessfulRequests: true,
  store: storeFor('auth'),
});

// Per-ACCOUNT brute-force protection, alongside the per-IP authLimiter above.
//
// authLimiter counts per IP, so a guesser who spreads attempts over many
// addresses (a botnet, rotating proxies) gets 5 tries per address per window
// against the same account, which is effectively unlimited. This counts failed
// logins per EMAIL instead, from anywhere: 10 per 15 minutes, then the account
// refuses further attempts until the window ends.
//
// Applied to every email, whether or not an account exists: locking only real
// accounts would turn the 429 into an oracle for which emails are registered,
// undoing the equal-cost login in routes/auth.ts.
//
// THE TRADE, stated: anyone can lock a known email out for 15 minutes by
// spending 10 wrong passwords on it. That is the standard cost of account
// lockout; a short window that clears itself keeps it a nuisance rather than a
// takeover, and the IP limit still caps how fast one source can do it.
//
// The key is a SHA-256 of the normalised email, so raw addresses never sit in
// Redis. Counted in the shared store (#6), or a guesser would get 10 tries per
// replica.
export const ACCOUNT_LOGIN_MAX_FAILURES = 10;
export const accountLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: ACCOUNT_LOGIN_MAX_FAILURES,
  standardHeaders: true,
  legacyHeaders: false,
  // The same text as the IP limiter, so the response does not say which limit
  // tripped (and so nothing about the account).
  message: { error: 'Too many login attempts, please try again in 15 minutes' },
  skipSuccessfulRequests: true,
  // No email means validation will 400 it; that is not a password guess.
  skip: (req) => typeof req.body?.email !== 'string' || !req.body.email.trim(),
  keyGenerator: (req) =>
    createHash('sha256').update(String(req.body.email).trim().toLowerCase()).digest('hex'),
  store: storeFor('account'),
});

// AI endpoints — cost protection, keyed per authenticated user
// Applied inside routes after authenticate() so req.user is populated
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI request limit reached, please wait before sending more' },
  keyGenerator: (req) => {
    const authReq = req as AuthenticatedRequest;
    if (authReq.user?.id) return authReq.user.id;
    // Fall back to IP, normalised via the helper so IPv6 clients (which get a
    // fresh address per request) can't trivially bypass the per-key limit.
    return ipKeyGenerator(req.ip ?? '');
  },
  store: storeFor('ai'),
});
