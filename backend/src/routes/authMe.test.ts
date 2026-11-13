import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const flags = vi.hoisted(() => ({ production: false, profileReadFails: false }));
vi.mock('../config/env', async (importOriginal) => {
  const real = await importOriginal<typeof import('../config/env')>();
  return { ...real, get isProduction() { return flags.production; } };
});

// Two different reads hit the User table on GET /me: the auth gate's session
// check (role/fleetId/tokensValidAfter) and the profile read (with createdAt).
// The case under test is the gate succeeding (e.g. from its 30s cache) while
// the profile read fails, so the double fails only the second.
vi.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ select }: { select?: Record<string, boolean> }) => {
        if (select?.createdAt) {
          if (flags.profileReadFails) throw new Error('ECONNREFUSED');
          return {
            id: 'u1', email: 'u1@example.com', name: 'U1', role: 'viewer', fleetId: 'fleet-002',
            createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'),
          };
        }
        return { role: 'viewer', fleetId: 'fleet-002', tokensValidAfter: null };
      }),
    },
  },
}));

import { createApp } from '../app';
import { clearSessionCache } from '../lib/session';
import { JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE } from '../lib/jwtConfig';

const app = createApp();
// Token says fleet_manager / fleet-001; the account has since changed.
const token = jwt.sign(
  { id: 'u1', email: 'u1@example.com', name: 'U1', role: 'fleet_manager', fleetId: 'fleet-001' },
  JWT_SECRET,
  { expiresIn: '1h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
);
const me = () => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

beforeEach(() => {
  clearSessionCache();
  flags.production = false;
  flags.profileReadFails = false;
});

describe('GET /api/auth/me', () => {
  it('returns the database record when it can read it, not degraded', async () => {
    const res = await me();
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'viewer', fleetId: 'fleet-002' });
    expect(res.body.degraded).toBeUndefined();
    expect(res.headers['x-data-source']).toBeUndefined();
  });

  it('in production, refuses with 503 rather than pass a cached session off as the record', async () => {
    flags.production = true;
    flags.profileReadFails = true;
    const res = await me();
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Database unavailable' });
  });

  it('outside production, answers but marks the response as not from the database', async () => {
    flags.profileReadFails = true;
    const res = await me();
    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(true);
    expect(res.headers['x-data-source']).toBe('token');
  });
});
