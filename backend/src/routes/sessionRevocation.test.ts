import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// A small stateful stand-in for the User table: one row, which update() really
// changes. That lets this suite run the whole revocation round trip through
// the real app (routes, auth gate, session check) with no Postgres.
const db = vi.hoisted(() => ({
  row: null as null | Record<string, unknown>,
}));
vi.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string } }) =>
        db.row && where.id === db.row.id ? { ...db.row } : null),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.row = { ...db.row, ...data };
        return db.row;
      }),
    },
    auditLog: { create: vi.fn() },
  },
}));

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { clearSessionCache } from '../lib/session';
import { JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE } from '../lib/jwtConfig';

const app = createApp();
const CLAIMS = { id: 'u1', email: 'u1@example.com', name: 'U1', role: 'fleet_manager', fleetId: 'fleet-001' };

/** A token as login mints it, issued `ageSeconds` ago. */
function token(ageSeconds = 0): string {
  const iat = Math.floor(Date.now() / 1000) - ageSeconds;
  return jwt.sign({ ...CLAIMS, iat }, JWT_SECRET, {
    expiresIn: '7d', issuer: JWT_ISSUER, audience: JWT_AUDIENCE,
  });
}
const me = (t: string) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${t}`);

beforeEach(() => {
  clearSessionCache();
  db.row = {
    id: 'u1', email: 'u1@example.com', name: 'U1', role: 'fleet_manager', fleetId: 'fleet-001',
    tokensValidAfter: null, createdAt: new Date(), updatedAt: new Date(),
  };
});

describe('sign out everywhere', () => {
  it('kills every existing token, and a fresh login still works', async () => {
    const laptop = token(60); // signed in an hour ago...
    const phone = token(30);  // ...and on a second device since
    expect((await me(laptop)).status).toBe(200);
    expect((await me(phone)).status).toBe(200);

    const signOut = await request(app).post('/api/auth/logout-all').set('Authorization', `Bearer ${phone}`);
    expect(signOut.status).toBe(204);

    // Both devices are out, including the one that asked.
    for (const old of [laptop, phone]) {
      const res = await me(old);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Session revoked');
    }

    // Signing in again works, even within the same second as the revoke.
    expect((await me(token(0))).status).toBe(200);
  });

  it('records the revocation in the audit trail', async () => {
    await request(app).post('/api/auth/logout-all').set('Authorization', `Bearer ${token(10)}`);
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u1', entity: 'User', action: 'revoke_sessions', entityId: 'u1' }),
    });
  });

  it('requires a valid session to call', async () => {
    expect((await request(app).post('/api/auth/logout-all')).status).toBe(401);
  });
});

describe('changes to the account apply to tokens already issued', () => {
  it('a manager moved to another fleet loses the old fleet on their next request', async () => {
    // The vessel routes read req.user.fleetId. Before #5 that came from the
    // token, so a moved manager kept reading the old fleet for up to 7 days.
    const t = token(60);
    const before = await request(app).get('/api/vessels/vessel-001').set('Authorization', `Bearer ${t}`);
    expect(before.status).toBe(200); // exact, so a wrong path cannot pass as "not forbidden"

    db.row = { ...db.row, fleetId: 'fleet-999' };
    clearSessionCache(); // stand-in for the 30s cache window passing

    const after = await request(app).get('/api/vessels/vessel-001').set('Authorization', `Bearer ${t}`);
    expect(after.status).toBe(403);
  });

  it('a deleted account is refused on its next request', async () => {
    const t = token(60);
    expect((await me(t)).status).toBe(200);
    db.row = null;
    clearSessionCache();
    expect((await me(t)).status).toBe(401);
  });
});
