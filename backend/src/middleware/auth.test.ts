import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { Response, NextFunction } from 'express';
import { JWT_SECRET } from '../lib/jwtConfig';
import { authenticate, requireRole, AuthenticatedRequest } from './auth';

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
  it('attaches req.user and calls next() for a valid token', () => {
    const token = jwt.sign(PAYLOAD, JWT_SECRET, { expiresIn: '1h' });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next: NextFunction = vi.fn();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: 'u1', role: 'fleet_manager', fleetId: 'fleet-001' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header', () => {
    const req = mockReq();
    const res = mockRes();
    const next: NextFunction = vi.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a malformed/invalid token', () => {
    const req = mockReq('Bearer not-a-real-jwt');
    const res = mockRes();
    const next: NextFunction = vi.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an expired token distinctly from an invalid one', () => {
    const token = jwt.sign(PAYLOAD, JWT_SECRET, { expiresIn: -1 });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next: NextFunction = vi.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token expired' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token signed with a different secret — cannot be forged', () => {
    const token = jwt.sign(PAYLOAD, 'a-completely-different-secret-that-is-long-enough', { expiresIn: '1h' });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next: NextFunction = vi.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireRole', () => {
  it('calls next() when the user has an allowed role', () => {
    const req = mockReq();
    req.user = { ...PAYLOAD };
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireRole(['fleet_manager', 'admin'])(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responds 403 when the user role is not allowed', () => {
    const req = mockReq();
    req.user = { ...PAYLOAD, role: 'viewer' };
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireRole(['fleet_manager', 'admin'])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 401 when there is no authenticated user', () => {
    const req = mockReq();
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requireRole(['fleet_manager'])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
