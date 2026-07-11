import { z } from 'zod';

// Open-Meteo Marine + Forecast APIs. Both are free and keyless. The marine
// endpoint carries waves + ocean currents; wind/weather come from the standard
// forecast endpoint — so one "observation" is composed from two sources, which
// is representative of real customer data integration.
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// Provider response validation. Fields are nullable/optional because coastal or
// inland-ish grid cells legitimately return null for some wave/current values —
// only `time` is guaranteed. Unexpected shapes fail fast at .parse().
export const marineCurrentSchema = z.object({
  time: z.string(),
  wave_height: z.number().nullable().optional(),
  wave_direction: z.number().nullable().optional(),
  ocean_current_velocity: z.number().nullable().optional(),
  ocean_current_direction: z.number().nullable().optional(),
});
export const forecastCurrentSchema = z.object({
  time: z.string(),
  wind_speed_10m: z.number().nullable().optional(),
  wind_direction_10m: z.number().nullable().optional(),
  weather_code: z.number().nullable().optional(),
});

const marineResponseSchema = z.object({ current: marineCurrentSchema });
const forecastResponseSchema = z.object({ current: forecastCurrentSchema });

export type MarineCurrent = z.infer<typeof marineCurrentSchema>;
export type ForecastCurrent = z.infer<typeof forecastCurrentSchema>;

export interface MonitoredPoint {
  name?: string;
  latitude: number;
  longitude: number;
}

export interface NormalizedObservation {
  latitude: number;
  longitude: number;
  locationName?: string;
  observedAt: Date;
  waveHeight: number | null;
  waveDirection: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  currentSpeed: number | null;
  currentDirection: number | null;
  weatherCode: number | null;
}

/**
 * Open-Meteo returns naive timestamps in GMT (e.g. "2026-07-12T00:00", no
 * offset) when no `timezone` param is sent. `new Date()` parses a naive
 * date-time as *local* time, which would shift every observation by the host's
 * UTC offset — so we explicitly mark it UTC. Padded to seconds precision first
 * for broad parser compatibility.
 */
function parseProviderTime(raw: string): Date {
  let s = raw.trim();
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  if (!hasTz) {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s = `${s}:00`;
    s = `${s}Z`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid observation time from provider: ${raw}`);
  }
  return d;
}

/**
 * Combine the marine + forecast "current" blocks into one normalized row.
 * Pure and side-effect-free so it can be unit-tested without any network.
 * Uses the marine timestamp as the canonical observation time and rejects an
 * unparseable one rather than silently storing an invalid date.
 */
export function transformObservation(input: {
  latitude: number;
  longitude: number;
  locationName?: string;
  marine: MarineCurrent;
  forecast: ForecastCurrent;
}): NormalizedObservation {
  const { latitude, longitude, locationName, marine, forecast } = input;
  const observedAt = parseProviderTime(marine.time);
  return {
    latitude,
    longitude,
    locationName,
    observedAt,
    waveHeight: marine.wave_height ?? null,
    waveDirection: marine.wave_direction ?? null,
    windSpeed: forecast.wind_speed_10m ?? null,
    windDirection: forecast.wind_direction_10m ?? null,
    currentSpeed: marine.ocean_current_velocity ?? null,
    currentDirection: marine.ocean_current_direction ?? null,
    weatherCode: forecast.weather_code ?? null,
  };
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const resp = await fetch(url, { signal });
  if (!resp.ok) {
    throw new Error(`Open-Meteo request failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

/**
 * Fetch → validate → transform a single point's current marine conditions.
 * Both upstream calls run in parallel and share a timeout budget.
 */
export async function fetchObservation(
  point: MonitoredPoint,
  opts: { timeoutMs?: number } = {}
): Promise<NormalizedObservation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const marineUrl =
      `${MARINE_URL}?latitude=${point.latitude}&longitude=${point.longitude}` +
      `&current=wave_height,wave_direction,ocean_current_velocity,ocean_current_direction`;
    const forecastUrl =
      `${FORECAST_URL}?latitude=${point.latitude}&longitude=${point.longitude}` +
      `&current=wind_speed_10m,wind_direction_10m,weather_code&wind_speed_unit=kn`;

    const [marineRaw, forecastRaw] = await Promise.all([
      fetchJson(marineUrl, controller.signal),
      fetchJson(forecastUrl, controller.signal),
    ]);

    const marine = marineResponseSchema.parse(marineRaw).current;
    const forecast = forecastResponseSchema.parse(forecastRaw).current;

    return transformObservation({
      latitude: point.latitude,
      longitude: point.longitude,
      locationName: point.name,
      marine,
      forecast,
    });
  } finally {
    clearTimeout(timer);
  }
}
