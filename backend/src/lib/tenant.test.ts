import { describe, it, expect, vi } from 'vitest';
import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { MOCK_VESSELS } from '../mock/vessels';
import {
  fleetVessels,
  canAccessVessel,
  requireVessel,
  resolveFleetVessel,
  requireFleetAccess,
  requireFleetMembership,
} from './tenant';

// vessel-001 and vessel-002 belong to fleet-001, vessel-003 also belongs to
// fleet-001 in the current fixtures — use a fleet the fixtures don't contain
// ('fleet-999') to exercise the "no accessible vessels" paths.
const OWN_FLEET_ID = MOCK_VESSELS[0].fleetId;
const OWN_VESSEL_ID = MOCK_VESSELS[0].id;
const OTHER_FLEET_VESSEL_ID = 'vessel-does-not-exist-in-any-fleet';

function mockReq(fleetId?: string | null): AuthenticatedRequest {
  return {
    user: fleetId === undefined ? undefined : { id: 'u1', email: 'a@b.com', role: 'engineer', fleetId, name: 'Test' },
  } as AuthenticatedRequest;
}

function mockRes(): Response {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

describe('fleetVessels', () => {
  it('returns only vessels in the caller fleet', () => {
    const vessels = fleetVessels(mockReq(OWN_FLEET_ID));
    expect(vessels.length).toBeGreaterThan(0);
    expect(vessels.every(v => v.fleetId === OWN_FLEET_ID)).toBe(true);
  });

  it('returns an empty list when the caller has no fleet', () => {
    expect(fleetVessels(mockReq(null))).toEqual([]);
    expect(fleetVessels(mockReq(undefined))).toEqual([]);
  });

  it('returns an empty list for a fleet with no vessels', () => {
    expect(fleetVessels(mockReq('fleet-does-not-exist'))).toEqual([]);
  });
});

describe('canAccessVessel', () => {
  it('allows access to a vessel in the caller fleet', () => {
    expect(canAccessVessel(mockReq(OWN_FLEET_ID), OWN_VESSEL_ID)).toBe(true);
  });

  it('denies access to a vessel outside the caller fleet', () => {
    expect(canAccessVessel(mockReq('fleet-999'), OWN_VESSEL_ID)).toBe(false);
  });

  it('denies access when the caller has no fleet', () => {
    expect(canAccessVessel(mockReq(null), OWN_VESSEL_ID)).toBe(false);
  });

  it('denies access when no vesselId is given', () => {
    expect(canAccessVessel(mockReq(OWN_FLEET_ID), undefined)).toBe(false);
  });
});

describe('requireVessel', () => {
  it('returns the vessel and writes nothing when access is permitted', () => {
    const res = mockRes();
    const vessel = requireVessel(mockReq(OWN_FLEET_ID), res, OWN_VESSEL_ID);
    expect(vessel?.id).toBe(OWN_VESSEL_ID);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responds 404 for a vessel that does not exist', () => {
    const res = mockRes();
    const vessel = requireVessel(mockReq(OWN_FLEET_ID), res, OTHER_FLEET_VESSEL_ID);
    expect(vessel).toBeNull();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('responds 403 (not 404) for a real vessel in a different fleet — prevents IDOR', () => {
    const res = mockRes();
    const vessel = requireVessel(mockReq('fleet-999'), res, OWN_VESSEL_ID);
    expect(vessel).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('resolveFleetVessel', () => {
  it('returns the requested vessel when accessible', () => {
    const vessel = resolveFleetVessel(mockReq(OWN_FLEET_ID), OWN_VESSEL_ID);
    expect(vessel?.id).toBe(OWN_VESSEL_ID);
  });

  it('falls back to the first fleet vessel when the requested one is inaccessible', () => {
    const vessel = resolveFleetVessel(mockReq(OWN_FLEET_ID), 'not-in-this-fleet');
    expect(vessel?.fleetId).toBe(OWN_FLEET_ID);
  });

  it('never returns a vessel from another fleet', () => {
    const vessel = resolveFleetVessel(mockReq(OWN_FLEET_ID), 'vessel-in-another-fleet');
    expect(vessel?.fleetId).toBe(OWN_FLEET_ID);
  });

  it('returns undefined when the caller has no accessible vessels', () => {
    expect(resolveFleetVessel(mockReq(null), OWN_VESSEL_ID)).toBeUndefined();
  });
});

describe('requireFleetAccess', () => {
  it('allows a caller whose fleetId matches the path param', () => {
    const res = mockRes();
    expect(requireFleetAccess(mockReq(OWN_FLEET_ID), res, OWN_FLEET_ID)).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a caller whose fleetId does not match the path param', () => {
    const res = mockRes();
    expect(requireFleetAccess(mockReq(OWN_FLEET_ID), res, 'fleet-999')).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects a caller with no fleet', () => {
    const res = mockRes();
    expect(requireFleetAccess(mockReq(null), res, OWN_FLEET_ID)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('requireFleetMembership', () => {
  it('allows any caller that belongs to a fleet', () => {
    const res = mockRes();
    expect(requireFleetMembership(mockReq(OWN_FLEET_ID), res)).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a caller with a null fleet (a self-service registrant)', () => {
    const res = mockRes();
    expect(requireFleetMembership(mockReq(null), res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects a caller with no user at all', () => {
    const res = mockRes();
    expect(requireFleetMembership(mockReq(undefined), res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
