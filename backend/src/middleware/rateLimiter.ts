import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { AuthenticatedRequest } from './auth';
import { env } from '../config/env';

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
//
// Also per-pod: the default store is in-process memory, so N replicas means N
// independent counters and an effective ceiling of N x max. A shared store
// (Redis) is the fix, and is why this is abuse protection rather than a quota.
export const apiLimiter = rateLimit({
  windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  max: env.API_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
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
});
