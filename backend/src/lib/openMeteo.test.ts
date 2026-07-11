import { describe, it, expect } from 'vitest';
import { transformObservation, marineCurrentSchema, forecastCurrentSchema } from './openMeteo';

describe('transformObservation', () => {
  it('normalizes marine + forecast current blocks into one observation', () => {
    const obs = transformObservation({
      latitude: 1.26,
      longitude: 103.82,
      locationName: 'Port of Singapore',
      marine: { time: '2026-07-12T00:00', wave_height: 1.2, wave_direction: 180, ocean_current_velocity: 0.4, ocean_current_direction: 90 },
      forecast: { time: '2026-07-12T00:00', wind_speed_10m: 12.5, wind_direction_10m: 210, weather_code: 3 },
    });

    expect(obs.locationName).toBe('Port of Singapore');
    expect(obs.waveHeight).toBe(1.2);
    expect(obs.windSpeed).toBe(12.5);
    expect(obs.currentSpeed).toBe(0.4);
    expect(obs.weatherCode).toBe(3);
    // Provider time is naive GMT — must be interpreted as UTC, not host-local.
    expect(obs.observedAt.toISOString()).toBe('2026-07-12T00:00:00.000Z');
  });

  it('coerces missing provider fields to null instead of throwing', () => {
    const obs = transformObservation({
      latitude: 5,
      longitude: 109,
      marine: { time: '2026-07-12T00:00' },
      forecast: { time: '2026-07-12T00:00' },
    });

    expect(obs.waveHeight).toBeNull();
    expect(obs.windSpeed).toBeNull();
    expect(obs.currentDirection).toBeNull();
    expect(obs.weatherCode).toBeNull();
  });

  it('rejects an invalid provider timestamp', () => {
    expect(() =>
      transformObservation({
        latitude: 1,
        longitude: 1,
        marine: { time: 'not-a-date' },
        forecast: { time: 'not-a-date' },
      })
    ).toThrow(/Invalid observation time/);
  });
});

describe('provider response validation', () => {
  it('accepts a well-formed marine current block', () => {
    expect(marineCurrentSchema.safeParse({ time: 't', wave_height: 1 }).success).toBe(true);
  });

  it('rejects a marine block missing the required time field', () => {
    expect(marineCurrentSchema.safeParse({ wave_height: 1 }).success).toBe(false);
  });

  it('accepts nulls in the forecast current block', () => {
    expect(forecastCurrentSchema.safeParse({ time: 't', wind_speed_10m: null }).success).toBe(true);
  });

  it('rejects a wrong type for a numeric field', () => {
    expect(marineCurrentSchema.safeParse({ time: 't', wave_height: 'high' }).success).toBe(false);
  });
});
