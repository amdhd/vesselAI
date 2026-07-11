import { z } from 'zod';

// aisstream.io v0 message envelope. Only the fields we consume are declared;
// Zod strips the rest. Everything past MessageType is optional because the
// stream carries many message types and partial payloads.
const aisMessageSchema = z.object({
  MessageType: z.string(),
  MetaData: z
    .object({
      MMSI: z.number(),
      ShipName: z.string().optional(),
      time_utc: z.string().optional(),
    })
    .optional(),
  Message: z
    .object({
      PositionReport: z
        .object({
          Latitude: z.number(),
          Longitude: z.number(),
          Sog: z.number().optional(),
          Cog: z.number().optional(),
          TrueHeading: z.number().optional(),
          NavigationalStatus: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

export interface NormalizedAisPosition {
  mmsi: number;
  shipName: string | null;
  latitude: number;
  longitude: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  navStatus: number | null;
  timeUtc: string | null;
}

// AIS "not available" sentinels the decoder passes through.
const HEADING_NOT_AVAILABLE = 511;

/**
 * Parse one aisstream message into a normalized position, or return null when
 * it isn't a usable PositionReport. Pure and network-free so the whole decode +
 * data-quality path is unit-testable. Drops out-of-range coordinates (the AIS
 * lat=91 / lon=181 "unavailable" sentinels) so they never pollute the map, and
 * cleans the '@'-padded ship names AIS transmits.
 */
export function parseAisPositionReport(raw: unknown): NormalizedAisPosition | null {
  const parsed = aisMessageSchema.safeParse(raw);
  if (!parsed.success) return null;

  const msg = parsed.data;
  if (msg.MessageType !== 'PositionReport') return null;

  const report = msg.Message?.PositionReport;
  const meta = msg.MetaData;
  if (!report || !meta) return null;

  const { Latitude: latitude, Longitude: longitude } = report;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }

  const shipName = meta.ShipName?.replace(/@+/g, '').trim() || null;
  const heading =
    report.TrueHeading == null || report.TrueHeading === HEADING_NOT_AVAILABLE
      ? null
      : report.TrueHeading;

  return {
    mmsi: meta.MMSI,
    shipName,
    latitude,
    longitude,
    sog: report.Sog ?? null,
    cog: report.Cog ?? null,
    heading,
    navStatus: report.NavigationalStatus ?? null,
    timeUtc: meta.time_utc ?? null,
  };
}
