/**
 * A vessel as returned by the VesselMind backend (GET /api/vessels). The shape
 * mirrors the Prisma `Vessel` model / mock fixtures on the server. Extra
 * server-only fields (fuel-model params, timestamps) are omitted here — the
 * dashboard only types what it actually consumes.
 */
export interface Vessel {
  id: string;
  name: string;
  imoNumber: string;
  type: string;
  flag: string;
  builtYear: number;
  dwt: number;
  engineType: string;
  enginePower: number;
  maxSpeed: number;
  designSpeed: number;
  fuelCapacity: number;
  currentLat: number;
  currentLon: number;
  currentSpeed: number;
  status: string;
  fleetId: string;
}

/**
 * Payload for creating/updating a vessel via the reactive form. These are the
 * operator-editable fields; server-managed fields (id, position, fleetId) are
 * not part of the form.
 */
export interface VesselInput {
  name: string;
  imoNumber: string;
  type: string;
  flag: string;
  builtYear: number;
  dwt: number;
  engineType: string;
  enginePower: number;
  maxSpeed: number;
  designSpeed: number;
  fuelCapacity: number;
  status: string;
}

/** Vessel types the fleet operates — drives the form's <select> options. */
export const VESSEL_TYPES = [
  'VLCC',
  'Suezmax Tanker',
  'Aframax Tanker',
  'Product Tanker',
  'Chemical Tanker',
  'LNG Carrier',
  'Bulk Carrier',
  'Container Ship',
  'Offshore Supply Vessel',
] as const;

/** Operational statuses used for the status pill and dashboard breakdown. */
export const VESSEL_STATUSES = ['active', 'in_transit', 'anchored', 'maintenance', 'idle'] as const;
