import { PrismaClient } from '@prisma/client';
import { MOCK_PORTS } from '../mock/ports';

const prisma = new PrismaClient();

// A vessel is treated as "waiting" if it's effectively stationary near a port —
// either barely moving (SOG below threshold) or reporting an at-anchor / moored
// AIS navigational status.
const ANCHOR_SOG_KN = 1.0;
const AT_ANCHOR_STATUS = 1;
const MOORED_STATUS = 5;
// ~0.25° ≈ 15 nm box around the port centre.
const NEAR_RADIUS_DEG = 0.25;

export interface AisPoint {
  latitude: number;
  longitude: number;
  sog: number | null;
  navStatus: number | null;
}

export interface PortLike {
  id: string;
  name: string;
  country?: string;
  lat: number;
  lon: number;
}

export type CongestionLevel = 'low' | 'medium' | 'high' | 'congested';

export function levelFromAnchored(n: number): CongestionLevel {
  if (n <= 2) return 'low';
  if (n <= 6) return 'medium';
  if (n <= 12) return 'high';
  return 'congested';
}

// A single AIS snapshot can't measure true dwell time, so estimate a plausible
// average wait from how many vessels are queued. Flagged as derived, not real.
function estimateWaitHours(anchored: number): number {
  return Math.min(anchored * 3, 48);
}

/**
 * Pure derivation: bucket live AIS positions by port and compute a congestion
 * level from the count of anchored/stationary vessels near each. No DB or
 * network, so it's fully unit-testable.
 */
export function computePortCongestion(positions: AisPoint[], ports: PortLike[]) {
  return ports.map((p) => {
    const near = positions.filter(
      (v) => Math.abs(v.latitude - p.lat) <= NEAR_RADIUS_DEG && Math.abs(v.longitude - p.lon) <= NEAR_RADIUS_DEG
    );
    const anchored = near.filter(
      (v) => (v.sog != null && v.sog < ANCHOR_SOG_KN) || v.navStatus === AT_ANCHOR_STATUS || v.navStatus === MOORED_STATUS
    ).length;
    return {
      portId: p.id,
      portName: p.name,
      country: p.country ?? null,
      congestionLevel: levelFromAnchored(anchored),
      vesselsAtAnchor: anchored,
      vesselsNearby: near.length,
      avgWaitingTime: estimateWaitHours(anchored),
      forecast: [] as { date: string; level: CongestionLevel }[],
      source: 'ais-derived' as const,
    };
  });
}

/**
 * Derive congestion from the AIS positions the stream has ingested. Returns
 * null when there's no AIS data yet (DB empty or unreachable) so the caller can
 * fall back to the mock fixtures.
 */
export async function derivePortCongestionFromAis() {
  let positions: AisPoint[];
  try {
    positions = await prisma.aisVesselPosition.findMany({
      select: { latitude: true, longitude: true, sog: true, navStatus: true },
    });
  } catch {
    return null; // DB unavailable → fall back to mock
  }
  if (positions.length === 0) return null;

  const ports: PortLike[] = MOCK_PORTS.map((p) => ({ id: p.id, name: p.name, country: p.country, lat: p.lat, lon: p.lon }));
  return computePortCongestion(positions, ports);
}
