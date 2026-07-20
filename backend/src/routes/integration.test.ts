import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app';
import { JWT_SECRET } from '../lib/jwtConfig';

// Route-integration tests exercise the real Express app end-to-end (auth
// middleware, validation, tenant scoping, route handlers) through HTTP,
// rather than calling handler functions directly. No database is required:
// DATABASE_URL is unset in CI, so every Prisma call below fails fast and
// exercises the same graceful-degradation paths the app relies on when a
// customer's DB is briefly unreachable (login falls back to demo creds,
// AIS/weather routes return a clean 503 instead of a stack trace).
const app = createApp();

describe('GET /api/health', () => {
  it('responds ok without auth', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /api/auth/login', () => {
  it('rejects a malformed payload with 400 before touching the DB', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('logs in with demo credentials when the DB is unreachable', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'demo@petronas.com', password: 'demo123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('demo@petronas.com');
    expect(res.body.user.fleetId).toBe('fleet-001');
  });

  it('reports DB-unavailable (not a 500) for a non-demo login when the DB is unreachable', async () => {
    // With no DB reachable, only the exact demo credentials hit the fallback
    // path — any other login correctly reports 503 "DB unavailable" rather
    // than a misleading "invalid credentials" or an unhandled 500.
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'demo@petronas.com', password: 'wrong-password' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/database unavailable/i);
  });
});

// Shared demo bearer token for routes below, minted the same way a real
// client would get one — through the login endpoint, not a hand-crafted JWT.
async function demoToken(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'demo@petronas.com', password: 'demo123' });
  return res.body.token as string;
}

describe('auth middleware', () => {
  it('rejects protected routes with no token', async () => {
    const res = await request(app).get('/api/voyage/active/fleet-001');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed bearer token', async () => {
    const res = await request(app)
      .get('/api/voyage/active/fleet-001')
      .set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/voyage/active/:fleetId (tenant isolation)', () => {
  it('serves the caller fleet', async () => {
    const token = await demoToken();
    const res = await request(app)
      .get('/api/voyage/active/fleet-001')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.fleetId).toBe('fleet-001');
    expect(Array.isArray(res.body.activeVoyages)).toBe(true);
  });

  it('blocks a fleet the caller does not belong to', async () => {
    const token = await demoToken();
    const res = await request(app)
      .get('/api/voyage/active/some-other-fleet')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/voyage/calculate-speed', () => {
  it('computes a speed-power curve for an accessible vessel', async () => {
    const token = await demoToken();
    const res = await request(app)
      .post('/api/voyage/calculate-speed')
      .set('Authorization', `Bearer ${token}`)
      .send({ vesselId: 'vessel-001', targetSpeed: 14, cargoLoad: 80 });
    expect(res.status).toBe(200);
    expect(res.body.vessel).toBeTruthy();
    expect(Array.isArray(res.body.speedCurve)).toBe(true);
  });

  it('rejects an invalid body with 400', async () => {
    const token = await demoToken();
    const res = await request(app)
      .post('/api/voyage/calculate-speed')
      .set('Authorization', `Bearer ${token}`)
      .send({ vesselId: 'vessel-001', targetSpeed: 'fast' });
    expect(res.status).toBe(400);
  });
});

// A valid app-signed token for a user with no fleet — the default state of a
// self-service registrant (RegisterSchema assigns fleetId: null).
function noFleetToken(): string {
  return jwt.sign(
    { id: 'u-nofleet', email: 'nofleet@x.com', role: 'fleet_manager', name: 'No Fleet', fleetId: null },
    JWT_SECRET
  );
}

describe('GET /api/ais/positions (fleet-membership gate)', () => {
  it('degrades to a clean 503 for a fleet member when the DB is unreachable', async () => {
    const token = await demoToken(); // demo user is in fleet-001
    const res = await request(app)
      .get('/api/ais/positions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(503);
    expect(res.body.error).toBeTruthy();
  });

  it('blocks a user with no fleet with 403 (never reaching the AIS data)', async () => {
    const res = await request(app)
      .get('/api/ais/positions')
      .set('Authorization', `Bearer ${noFleetToken()}`);
    expect(res.status).toBe(403);
  });

  it('blocks a no-fleet user on the /near variant too', async () => {
    const res = await request(app)
      .get('/api/ais/positions/near?lat=3&lon=101')
      .set('Authorization', `Bearer ${noFleetToken()}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/imports/bunker/template', () => {
  it('serves the CSV template to an authenticated caller', async () => {
    const token = await demoToken();
    const res = await request(app)
      .get('/api/imports/bunker/template')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('imoNumber');
  });
});

describe('unmatched API route', () => {
  it('returns a structured 404', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
  });
});
