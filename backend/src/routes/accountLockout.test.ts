import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

// A reachable database with one real account, so login reaches the password
// check, and the app trusts one proxy hop so each request can claim its own
// client IP through X-Forwarded-For. That is how these tests play a guesser
// spread over many addresses, which the per-IP limiter alone cannot stop.
vi.mock('../lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() }, auditLog: { create: vi.fn() } },
}));

import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { ACCOUNT_LOGIN_MAX_FAILURES } from '../middleware/rateLimiter';

const VICTIM = 'victim@example.com';
let app: import('express').Application;

beforeAll(async () => {
  env.TRUST_PROXY = '1';
  const { createApp } = await import('../app');
  app = createApp();
  const hash = bcrypt.hashSync('the-right-password', 12);
  vi.mocked(prisma.user.findUnique).mockImplementation((async ({ where }: { where: { email?: string; id?: string } }) =>
    where.email === VICTIM
      ? { id: 'u-victim', email: VICTIM, password: hash, name: 'V', role: 'viewer', fleetId: null }
      : null) as never);
});

// Each call comes from a fresh IP, so the per-IP limit (5) never trips: any
// 429 here is the per-account limit.
let ipCounter = 0;
const login = (email: string, password = 'wrong-password') =>
  request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', `203.0.113.${++ipCounter % 250}`)
    .send({ email, password });

describe('per-account login lockout', () => {
  it('locks an account after its failures, however many IPs they come from', async () => {
    for (let i = 0; i < ACCOUNT_LOGIN_MAX_FAILURES; i++) {
      expect((await login(VICTIM)).status).toBe(401);
    }
    expect((await login(VICTIM)).status).toBe(429);
    // Locked means locked: the right password waits for the window too, or
    // the guesser's next try could be the right one.
    expect((await login(VICTIM, 'the-right-password')).status).toBe(429);
  }, 60_000);

  it('treats case and surrounding whitespace as the same account', async () => {
    const email = 'variants@example.com';
    for (let i = 0; i < ACCOUNT_LOGIN_MAX_FAILURES; i++) {
      await login(i % 2 ? email.toUpperCase() : `  ${email} `);
    }
    expect((await login(email)).status).toBe(429);
  }, 60_000);

  it('locks unknown emails the same way, so the 429 reveals nothing about registration', async () => {
    const email = 'nobody-registered@example.com';
    for (let i = 0; i < ACCOUNT_LOGIN_MAX_FAILURES; i++) {
      expect((await login(email)).status).toBe(401);
    }
    expect((await login(email)).status).toBe(429);
  }, 60_000);

  it('does not lock other accounts', async () => {
    expect((await login('bystander@example.com')).status).toBe(401);
  });

  it('answers with the same message as the per-IP limit', async () => {
    const res = await login(VICTIM);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('Too many login attempts, please try again in 15 minutes');
  });
});
