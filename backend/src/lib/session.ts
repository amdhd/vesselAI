// Live session state: what the DATABASE says about a token's user right now.
//
// WHY THIS EXISTS. A JWT is a snapshot. Role and fleetId are copied into it at
// login and the token is good for JWT_EXPIRES_IN (7 days by default). Before
// this module every authorization decision in the app (requireRole, the fleet
// tenancy helpers, the socket room join) read those copied claims, so removing
// someone from a fleet, demoting them, or deleting their account took effect
// only when their token happened to expire. Up to a week.
//
// So the gates now treat the token as proof of WHO the caller is, and ask the
// database WHAT they may do:
//   - role and fleetId come from the User row, not the token;
//   - a token issued before User.tokensValidAfter is refused, which is how
//     "sign out everywhere" works without tracking every token;
//   - a token for a user who no longer exists is refused.
//
// Both gates (middleware/auth.ts and lib/fleetSockets.ts) call authorizeClaims,
// so REST and sockets cannot disagree about who is still signed in.
import { prisma } from './prisma';
import { isProduction } from '../config/env';
import { DEMO_LOGIN_ENABLED, DEMO_USER_ID } from './jwtConfig';

export interface LiveSession {
  role: string;
  fleetId: string | null;
  tokensValidAfter: Date | null;
}

/** The identity the gates hand to route code. role/fleetId are the LIVE values. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  fleetId: string | null;
}

/** The claims a verified app token carries (see routes/auth.ts generateToken). */
export interface TokenClaims {
  id: string;
  email?: string;
  name?: string;
  role?: string;
  fleetId?: string | null;
  iat?: number;
}

export type Authorization =
  | { ok: true; user: SessionUser }
  | { ok: false; status: 401 | 503; error: string };

// HOW STALE A DECISION MAY BE. Each request would otherwise cost a query. 30s
// is the window in which a revocation or a fleet change has not yet taken
// effect on a given pod. It is per pod: revokeSessions clears only the cache of
// the pod that handled the revoke, so other pods converge within this window.
// A shared cache would remove that lag; for revocation, 30s against the 7 days
// this replaces is the trade being made.
export const SESSION_CACHE_TTL_MS = 30_000;
// Bounded so tokens for many distinct users cannot grow it without limit.
const SESSION_CACHE_MAX = 10_000;

const cache = new Map<string, { value: LiveSession | null; expiresAt: number }>();

/**
 * The user's live session, or null if the user no longer exists. THROWS when
 * the database is unreachable. That is deliberately not folded into null:
 * "this user is gone" and "we cannot tell right now" call for different
 * answers (see authorizeClaims).
 */
export async function loadSession(userId: string): Promise<LiveSession | null> {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, fleetId: true, tokensValidAfter: true },
  });
  // A missing user is cached too, so a deleted account's token cannot make
  // every request a query.
  if (cache.size >= SESSION_CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(userId, { value: row, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
  return row;
}

/**
 * Invalidate every token the user holds. Tokens issued before now are refused
 * from the next request on this pod, and within SESSION_CACHE_TTL_MS on others.
 *
 * Truncated to the whole second because JWT `iat` is whole seconds. Storing the
 * exact millisecond would refuse a token issued later in the SAME second, so a
 * user who signs out everywhere and immediately signs back in would be locked
 * out of the new session. The cost of truncating is the reverse: a token issued
 * in the same second as the revoke, just before it, survives. That is a
 * sub-second race; the other is a guaranteed lockout.
 */
export async function revokeSessions(userId: string): Promise<void> {
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  await prisma.user.update({ where: { id: userId }, data: { tokensValidAfter: now } });
  cache.delete(userId);
}

/** For tests: forget every cached decision. */
export function clearSessionCache(): void {
  cache.clear();
}

const revoked = (): Authorization => ({ ok: false, status: 401, error: 'Session revoked' });

/**
 * Decide whether a VERIFIED token's claims are still a valid session, and with
 * what role and fleet. Signature, expiry and the claim contract are checked by
 * the caller first; this answers only "is that still true now?".
 */
export async function authorizeClaims(claims: TokenClaims): Promise<Authorization> {
  // Same rule as exp: every token the app mints has iat (jsonwebtoken sets it
  // by default), and revocation is meaningless without it.
  if (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat)) {
    return { ok: false, status: 401, error: 'Invalid token' };
  }
  const fromClaims: SessionUser = {
    id: claims.id,
    email: claims.email ?? '',
    name: claims.name ?? '',
    role: claims.role ?? '',
    fleetId: claims.fleetId ?? null,
  };

  let session: LiveSession | null;
  try {
    session = await loadSession(claims.id);
  } catch {
    // Database unreachable, so the session cannot be checked.
    //
    // In production that is a refusal: the point of this module is that a
    // revoked token stops working, and honouring the token's claims whenever
    // Postgres is down would make revocation fail open exactly then. It is 503
    // rather than 401 because the token may be fine; the client should retry,
    // not discard it. Readiness already fails while the database is down
    // (app.ts /api/ready), so the pod is taken out of rotation anyway.
    //
    // Outside production the app is designed to run with no database at all
    // (demo login, mock fixtures), so the signed claims are trusted, as they
    // were before this module existed.
    if (isProduction) return { ok: false, status: 503, error: 'Authentication temporarily unavailable' };
    return { ok: true, user: fromClaims };
  }

  if (!session) {
    // The demo account is issued from a hardcoded payload when the database is
    // unseeded (routes/auth.ts tryDemoLogin), so it has no row to check. Only
    // where demo login itself is allowed, which is never in production.
    if (DEMO_LOGIN_ENABLED && claims.id === DEMO_USER_ID) return { ok: true, user: fromClaims };
    return revoked();
  }

  if (session.tokensValidAfter && claims.iat * 1000 < session.tokensValidAfter.getTime()) {
    return revoked();
  }

  // Identity from the token, authority from the database.
  return { ok: true, user: { ...fromClaims, role: session.role, fleetId: session.fleetId } };
}
