import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { MOCK_VESSELS, MockVessel } from '../mock/vessels';

// Fleet-based tenant isolation. Every vessel belongs to exactly one fleet, and
// a user may only reach vessels within their own fleet (req.user.fleetId).
// A user with no fleet can reach nothing.

export function fleetVessels(req: AuthenticatedRequest): MockVessel[] {
  const fleetId = req.user?.fleetId;
  if (!fleetId) return [];
  return MOCK_VESSELS.filter((v) => v.fleetId === fleetId);
}

export function canAccessVessel(req: AuthenticatedRequest, vesselId?: string | null): boolean {
  const fleetId = req.user?.fleetId;
  if (!fleetId || !vesselId) return false;
  const vessel = MOCK_VESSELS.find((v) => v.id === vesselId);
  return !!vessel && vessel.fleetId === fleetId;
}

// Strict lookup: the vessel must exist AND belong to the caller's fleet.
// Writes a 404 (missing) or 403 (cross-fleet) response and returns null on failure.
export function requireVessel(
  req: AuthenticatedRequest,
  res: Response,
  vesselId?: string | null
): MockVessel | null {
  const vessel = MOCK_VESSELS.find((v) => v.id === vesselId);
  if (!vessel) {
    res.status(404).json({ error: 'Vessel not found' });
    return null;
  }
  if (vessel.fleetId !== req.user?.fleetId) {
    res.status(403).json({ error: 'Access to this vessel is not permitted' });
    return null;
  }
  return vessel;
}

// Lenient lookup for AI helper routes that take an optional vesselId: return the
// requested vessel when the caller may access it, otherwise fall back to the
// caller's first fleet vessel. Never returns a vessel outside the caller's fleet.
//
// Omitting vesselId legitimately means "whichever vessel this fleet is on". A
// vesselId that was *supplied* and resolved to nothing is a different request
// and must not collapse into that default: every caller reads the result as
// "the vessel this request is about", so substituting the fleet's first vessel
// answered a question about vessel-007 with vessel-001's name, IMO number and
// figures. A supplied id the caller cannot reach now fails the request.
//
// On failure it answers the response itself and returns null, like requireVessel
// above: 404 when a supplied id resolved to nothing, 403 when there was no id
// and the caller's fleet has no vessel to fall back to.
export function resolveFleetVessel(
  req: AuthenticatedRequest,
  res: Response,
  vesselId?: string | null
): MockVessel | null {
  const vessels = fleetVessels(req);
  if (vesselId) {
    const match = vessels.find((v) => v.id === vesselId);
    if (match) return match;
    // "Does not exist" and "belongs to another fleet" get the same answer on
    // purpose: this lookup only sees the caller's own fleet, so distinguishing
    // them would mean reporting on vessels outside it.
    res.status(404).json({ error: 'Vessel not found' });
    return null;
  }
  const fallback = vessels[0];
  if (!fallback) {
    res.status(403).json({ error: 'No accessible vessel for your fleet' });
    return null;
  }
  return fallback;
}

// Enforce that a :fleetId path param matches the caller's fleet.
export function requireFleetAccess(
  req: AuthenticatedRequest,
  res: Response,
  fleetId: string
): boolean {
  if (!req.user?.fleetId || req.user.fleetId !== fleetId) {
    res.status(403).json({ error: 'Access to this fleet is not permitted' });
    return false;
  }
  return true;
}

// Require the caller to belong to *some* fleet. Used for operational surfaces
// that aren't per-vessel-owned records — e.g. the live AIS map, which is public
// broadcast data scoped to the fleet's operating area rather than data any one
// fleet owns. A user with no fleet (the default for a self-service registrant)
// has no operational context — fleetVessels() already returns [] for them
// everywhere else — so they must not see the operational map either.
export function requireFleetMembership(req: AuthenticatedRequest, res: Response): boolean {
  if (!req.user?.fleetId) {
    res.status(403).json({ error: 'You are not assigned to a fleet' });
    return false;
  }
  return true;
}
