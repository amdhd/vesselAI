import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { AuthenticatedRequest } from './auth';

// General API — broad abuse protection
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
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
