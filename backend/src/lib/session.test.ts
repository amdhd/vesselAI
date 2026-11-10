import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const flags = vi.hoisted(() => ({ production: false }));
vi.mock('../config/env', async (importOriginal) => {
  const real = await importOriginal<typeof import('../config/env')>();
  return {
    ...real,
    get isProduction() {
      return flags.production;
    },
  };
});
vi.mock('./prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

import { prisma } from './prisma';
import {
  authorizeClaims,
  clearSessionCache,
  loadSession,
  revokeSessions,
  SESSION_CACHE_TTL_MS,
} from './session';
import { DEMO_USER_ID } from './jwtConfig';

const findUnique = vi.mocked(prisma.user.findUnique);
const update = vi.mocked(prisma.user.update);

// A token as login mints it: role and fleet copied in at that moment.
const NOW_S = 1_800_000_000;
const claims = (over: Record<string, unknown> = {}) => ({
  id: 'u1', email: 'a@b.c', name: 'A', role: 'fleet_manager', fleetId: 'fleet-a', iat: NOW_S, ...over,
});
const row = (over: Record<string, unknown> = {}) =>
  ({ role: 'fleet_manager', fleetId: 'fleet-a', tokensValidAfter: null, ...over }) as never;

beforeEach(() => {
  clearSessionCache();
  findUnique.mockReset();
  update.mockReset();
  flags.production = false;
});
afterEach(() => vi.useRealTimers());

describe('authorizeClaims: authority comes from the database, not the token', () => {
  it('uses the live role and fleet when they differ from the token', async () => {
    // The case #5 is about: demoted and moved since the token was minted.
    findUnique.mockResolvedValue(row({ role: 'viewer', fleetId: 'fleet-b' }));
    const result = await authorizeClaims(claims());
    expect(result).toEqual({
      ok: true,
      user: { id: 'u1', email: 'a@b.c', name: 'A', role: 'viewer', fleetId: 'fleet-b' },
    });
  });

  it('applies a removal from a fleet immediately', async () => {
    findUnique.mockResolvedValue(row({ fleetId: null }));
    const result = await authorizeClaims(claims());
    expect(result.ok && result.user.fleetId).toBeNull();
  });

  it("refuses a token whose user no longer exists", async () => {
    findUnique.mockResolvedValue(null);
    expect(await authorizeClaims(claims())).toEqual({ ok: false, status: 401, error: 'Session revoked' });
  });

  it('refuses a token without iat, since revocation cannot be checked against it', async () => {
    findUnique.mockResolvedValue(row());
    const result = await authorizeClaims(claims({ iat: undefined }));
    expect(result).toEqual({ ok: false, status: 401, error: 'Invalid token' });
  });
});

describe('authorizeClaims: revocation', () => {
  it('refuses a token issued before tokensValidAfter', async () => {
    findUnique.mockResolvedValue(row({ tokensValidAfter: new Date((NOW_S + 1) * 1000) }));
    expect(await authorizeClaims(claims())).toMatchObject({ ok: false, status: 401, error: 'Session revoked' });
  });

  it('accepts a token issued after tokensValidAfter (signed in again)', async () => {
    findUnique.mockResolvedValue(row({ tokensValidAfter: new Date((NOW_S - 60) * 1000) }));
    expect((await authorizeClaims(claims())).ok).toBe(true);
  });

  it('accepts a token issued in the same second as the revoke, so re-login is not locked out', async () => {
    findUnique.mockResolvedValue(row({ tokensValidAfter: new Date(NOW_S * 1000) }));
    expect((await authorizeClaims(claims())).ok).toBe(true);
  });
});

describe('authorizeClaims: database unreachable', () => {
  it('refuses with 503 in production, so revocation does not fail open during an outage', async () => {
    flags.production = true;
    findUnique.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await authorizeClaims(claims())).toEqual({
      ok: false, status: 503, error: 'Authentication temporarily unavailable',
    });
  });

  it('trusts the signed claims outside production, where the app runs with no database', async () => {
    findUnique.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await authorizeClaims(claims());
    expect(result).toEqual({
      ok: true,
      user: { id: 'u1', email: 'a@b.c', name: 'A', role: 'fleet_manager', fleetId: 'fleet-a' },
    });
  });

  it('accepts the demo account on an unseeded database outside production', async () => {
    findUnique.mockResolvedValue(null);
    expect((await authorizeClaims(claims({ id: DEMO_USER_ID }))).ok).toBe(true);
  });

  it('refuses any other missing account, even outside production', async () => {
    // The demo exemption is for one id only. (Production refuses the demo id
    // too: DEMO_LOGIN_ENABLED is false there, fixed at import from NODE_ENV.)
    findUnique.mockResolvedValue(null);
    expect((await authorizeClaims(claims({ id: 'someone-else' }))).ok).toBe(false);
  });
});

describe('loadSession cache', () => {
  it('serves repeat lookups from cache, then re-reads after the TTL', async () => {
    vi.useFakeTimers();
    findUnique.mockResolvedValue(row());
    await loadSession('u1');
    await loadSession('u1');
    expect(findUnique).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SESSION_CACHE_TTL_MS + 1);
    await loadSession('u1');
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('caches a missing user too, so a deleted account cannot make every request a query', async () => {
    findUnique.mockResolvedValue(null);
    await loadSession('gone');
    await loadSession('gone');
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('revokeSessions', () => {
  it('stores the revoke time truncated to the second, and drops the cached session', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_S * 1000 + 789));
    findUnique.mockResolvedValue(row());
    await loadSession('u1');

    await revokeSessions('u1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { tokensValidAfter: new Date(NOW_S * 1000) },
    });
    // The next decision must re-read, not reuse the pre-revoke cache entry.
    findUnique.mockResolvedValue(row({ tokensValidAfter: new Date(NOW_S * 1000) }));
    await loadSession('u1');
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
