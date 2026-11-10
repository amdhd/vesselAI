import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { join } from 'path';

// A reachable database with one known account, so login reaches the
// "no such user" and "wrong password" branches rather than the demo / 503
// fallbacks the other integration tests exercise.
vi.mock('../lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() }, auditLog: { create: vi.fn() } },
}));

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { TIMING_EQUALISER_HASH } from './auth';

const app = createApp();
const findUnique = vi.mocked(prisma.user.findUnique);
const KNOWN = 'known@example.com';
let knownHash: string;

beforeAll(() => {
  knownHash = bcrypt.hashSync('the-right-password', 12);
});

beforeEach(() => {
  findUnique.mockImplementation((async ({ where }: { where: { email: string } }) =>
    where.email === KNOWN
      ? { id: 'u1', email: KNOWN, password: knownHash, name: 'Known', role: 'viewer', fleetId: null }
      : null) as never);
});

afterEach(() => vi.restoreAllMocks());

const login = (email: string) =>
  request(app).post('/api/auth/login').send({ email, password: 'a-wrong-password' });

// Asserting on wall-clock time would be flaky in CI. What makes the two paths
// cost the same is that each performs exactly one cost-12 bcrypt compare, so
// that is what these tests pin down. (Measured once, through this same app:
// before the fix an unknown email answered in ~7ms against ~205ms for a known
// one; after it, ~210ms against ~203ms.)
//
// RATE-LIMIT BUDGET: authLimiter allows 5 FAILED logins per window, and this
// file spends exactly 5 (one, one, two, one). A sixth failing login here gets a
// 429 instead of a 401. Split into another file rather than raise the limit.
describe('login does not reveal whether an account exists', () => {
  it('pays for one bcrypt compare on an unknown email, against the equaliser hash', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    const res = await login('nobody@example.com');
    expect(res.status).toBe(401);
    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare.mock.calls[0][1]).toBe(TIMING_EQUALISER_HASH);
  });

  it('pays for exactly one compare on a known email with a wrong password too', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    const res = await login(KNOWN);
    expect(res.status).toBe(401);
    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare.mock.calls[0][1]).toBe(knownHash);
  });

  it('answers both cases with the same status and body', async () => {
    const unknown = await login('nobody@example.com');
    const known = await login(KNOWN);
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
  });

  it('still rejects an unknown email whose password happens to match the equaliser', async () => {
    // The compare result is discarded. Whatever was hashed to make the
    // equaliser, sending it must not log anyone in.
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    const res = await login('nobody@example.com');
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it('uses the same bcrypt cost as stored passwords', () => {
    // A cheaper equaliser would leave the unknown-email path measurably
    // faster. Read the cost factor from the code that stores passwords, so
    // raising it there without updating the equaliser fails here.
    const costs = [
      readFileSync(join(__dirname, 'auth.ts'), 'utf8'),
      readFileSync(join(__dirname, '../../prisma/seed.ts'), 'utf8'),
    ].flatMap((src) => [...src.matchAll(/bcrypt\.hash\([^,]+,\s*(\d+)\)/g)].map((m) => Number(m[1])));
    expect(costs.length).toBeGreaterThanOrEqual(2);
    for (const cost of costs) expect(bcrypt.getRounds(TIMING_EQUALISER_HASH)).toBe(cost);
  });
});
