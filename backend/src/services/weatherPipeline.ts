import { prisma } from '../lib/prisma';
import { fetchObservation, MonitoredPoint } from '../lib/openMeteo';
import { MARINE_LOCATIONS } from '../lib/marineLocations';

export interface SyncSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  locations: number;
  ingested: number;
  failed: number;
  errors: { location: string; error: string }[];
}

/**
 * Ingestion run: for each monitored point, fetch → validate → transform →
 * upsert. Points are processed in parallel and isolated — one point's failure
 * (network blip, provider hiccup, bad shape) is recorded but never aborts the
 * others, so a run degrades partially instead of all-or-nothing. The compound
 * unique (latitude, longitude, observedAt) makes re-runs idempotent.
 */
export async function syncWeather(locations: MonitoredPoint[] = MARINE_LOCATIONS): Promise<SyncSummary> {
  const startedAt = new Date();
  let ingested = 0;
  const errors: { location: string; error: string }[] = [];

  await Promise.all(
    locations.map(async (loc) => {
      try {
        const obs = await fetchObservation(loc);
        await prisma.weatherObservation.upsert({
          where: {
            latitude_longitude_observedAt: {
              latitude: obs.latitude,
              longitude: obs.longitude,
              observedAt: obs.observedAt,
            },
          },
          create: { ...obs, locationName: obs.locationName ?? null },
          update: { ...obs, locationName: obs.locationName ?? null, fetchedAt: new Date() },
        });
        ingested += 1;
      } catch (err) {
        errors.push({ location: loc.name ?? `${loc.latitude},${loc.longitude}`, error: err instanceof Error ? err.message : String(err) });
      }
    })
  );

  const finishedAt = new Date();
  const summary: SyncSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    locations: locations.length,
    ingested,
    failed: errors.length,
    errors,
  };
  console.log('[weather pipeline]', JSON.stringify({ ...summary, errors: errors.length }));
  return summary;
}

export function getLatestObservations(limit = 50) {
  return prisma.weatherObservation.findMany({ orderBy: { observedAt: 'desc' }, take: limit });
}

/** Bounding-box lookup around a point — used to back route weather with real data. */
export function getObservationsNear(latitude: number, longitude: number, radiusDeg = 1.5) {
  return prisma.weatherObservation.findMany({
    where: {
      latitude: { gte: latitude - radiusDeg, lte: latitude + radiusDeg },
      longitude: { gte: longitude - radiusDeg, lte: longitude + radiusDeg },
    },
    orderBy: { observedAt: 'desc' },
    take: 20,
  });
}
