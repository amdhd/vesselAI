import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { Response, NextFunction } from 'express';

// A reachable database holding user u1. The real session check
// (lib/session.ts) runs against it, so these tests cover what the gate does
// with the database's answer, not a mocked-away version of it.
vi.mock('../lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }));

import { JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE } from '../lib/jwtConfig';
import { prisma } from '../lib/prisma';
import { clearSessionCache } from '../lib/session';
import { authenticate, requireRole, AuthenticatedRequest } from './auth';

const CONTRACT = { issuer: JWT_ISSUER, audience: JWT_AUDIENCE };
const findUnique = vi.mocked(prisma.user.findUnique);
const liveRow = (over: Record<string, unknown> = {}) =>
  ({ role: 'fleet_manager', fleetId: 'fleet-001', tokensValidAfter: null, ...over }) as never;

beforeEach(() => {
  clearSessionCache();
  findUnique.mockReset();
  findUnique.mockResolvedValue(liveRow());
});

const PAYLOAD = { id: 'u1', email: 'demo@petronas.com', role: 'fleet_manager', fleetId: 'fleet-001', name: 'Demo' };

function mockRes(): Response {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

function mockReq(authHeader?: string): AuthenticatedRequest {
  return { headers: authHeader ? { authorization: authHeader } : {} } as AuthenticatedRequest;
}

describe('authenticate', () => {
  it('attaches req.user and calls next() for a valid token', async () => {
    const token = jwt.sign(PAYLOAD, JWT_SECRET, { expiresIn: '1h', ...CONTRACT });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next: NextFunction = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: 'u1', role: 'fleet_manager', fleetId: 'fleet-001' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header', async () => {
    const req = mockReq();
    const res = mockRes();
    const next: NextFunction = vi.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a malformed/invalid token', async () => {
    const req = mockReq('Bearer not-a-real-jwt');
    const res = mockRes();
    const next: NextFunction = vi.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an expired token distinctly from an invalid one', async () => {
    const token = jwt.sign(PAYLOAD, JWT_SECRET, { expiresIn: -1, ...CONTRACT });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next: NextFunction = vi.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token expired' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a correctly signed token that has no expiry', async () => {
    // jsonwebtoken only checks exp when it is present, so without the explicit
    // check this token would verify and never expire.
    const token = jwt.sign(PAYLOAD, JWT_SECRET, CONTRACT);
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next: NextFunction = vi.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token signed with a different secret — cannot be forged', async () => {
    const token = jwt.sign(PAYLOAD, 'a-completely-different-secret-that-is-long-enough', { expiresIn: '1h', ...CONTRACT });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next: NextFunction = vi.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireRole', () => {
  it('calls next() when the user has an allowed role', async () => {
    const req = mockReq();
    req.user = { ...PAYLOAD };
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireRole(['fleet_manager', 'admin'])(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responds 403 when the user role is not allowed', async () => {
    const req = mockReq();
    req.user = { ...PAYLOAD, role: 'viewer' };
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireRole(['fleet_manager', 'admin'])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 401 when there is no authenticated user', async () => {
    const req = mockReq();
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireRole(['fleet_manager'])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('authenticate — claim contract', () => {
  // Right secret, real expiry; only who-issued / who-for is wrong. That is a
  // token signed by something holding the secret, but not a session this app
  // minted — the case the contract exists to refuse.
  it.each([
    ['wrong audience', { issuer: JWT_ISSUER, audience: 'some-other-service' }],
    ['wrong issuer', { issuer: 'some-other-issuer', audience: JWT_AUDIENCE }],
    ['no audience', { issuer: JWT_ISSUER }],
    ['no issuer', { audience: JWT_AUDIENCE }],
  ])('rejects a token with %s', async (_label, contract) => {
    const token = jwt.sign(PAYLOAD, JWT_SECRET, { expiresIn: '1h', ...contract });
    const res = mockRes();
    const next: NextFunction = vi.fn();

    await authenticate(mockReq(`Bearer ${token}`), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// Review item #5: a token is a snapshot from login. These are the cases where
// that snapshot is now out of date, and the gate must follow the database.
describe('authenticate — the live session wins over the token', () => {
  const managerToken = () => jwt.sign(PAYLOAD, JWT_SECRET, { expiresIn: '7d', ...CONTRACT });

  it('applies a demotion before the token expires', async () => {
    findUnique.mockResolvedValue(liveRow({ role: 'viewer' }));
    const req = mockReq(`Bearer ${managerToken()}`);
    const res = mockRes();
    await authenticate(req, res, vi.fn());
    expect(req.user?.role).toBe('viewer');

    // And the role gate downstream acts on it: the old token no longer opens
    // a manager-only route.
    const next: NextFunction = vi.fn();
    requireRole(['fleet_manager'])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('applies a fleet change, and a removal from every fleet', async () => {
    findUnique.mockResolvedValue(liveRow({ fleetId: 'fleet-002' }));
    const moved = mockReq(`Bearer ${managerToken()}`);
    await authenticate(moved, mockRes(), vi.fn());
    expect(moved.user?.fleetId).toBe('fleet-002');

    clearSessionCache();
    findUnique.mockResolvedValue(liveRow({ fleetId: null }));
    const removed = mockReq(`Bearer ${managerToken()}`);
    await authenticate(removed, mockRes(), vi.fn());
    expect(removed.user?.fleetId).toBeNull();
  });

  it('refuses a token issued before a sign-out-everywhere', async () => {
    const token = managerToken();
    findUnique.mockResolvedValue(liveRow({ tokensValidAfter: new Date(Date.now() + 2000) }));
    const res = mockRes();
    const next: NextFunction = vi.fn();
    await authenticate(mockReq(`Bearer ${token}`), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Session revoked' });
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses the token of a deleted account', async () => {
    findUnique.mockResolvedValue(null);
    const res = mockRes();
    const next: NextFunction = vi.fn();
    await authenticate(mockReq(`Bearer ${managerToken()}`), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not report a downstream handler error as an authentication failure', async () => {
    // next() runs outside the gate's try blocks, so a route that throws reaches
    // the central error handler instead of becoming a 500 "Authentication error".
    const res = mockRes();
    const next = vi.fn(() => { throw new Error('route blew up'); });
    await expect(authenticate(mockReq(`Bearer ${managerToken()}`), res, next)).rejects.toThrow('route blew up');
    expect(res.status).not.toHaveBeenCalled();
  });
});
