import { describe, it, expect } from 'vitest';
import { findPortCoords, haversineNm, deterministicPlan, AgentVessel } from './voyageAgent';

// A representative Aframax-ish tanker (also satisfies VesselFuelParams).
const VESSEL: AgentVessel = {
  id: 'v1',
  name: 'MT Kerteh Venture',
  type: 'Oil Tanker',
  dwt: 115000,
  lightshipTonnage: 20000,
  enginePower: 13000,
  designSpeed: 14.5,
  maxSpeed: 16,
  sfocRefGPerKwh: 175,
  lastDrydockDate: '2024-01-01',
  fuelCapacity: 3000,
};

describe('findPortCoords', () => {
  it('resolves ports case-insensitively from the mock set', () => {
    expect(findPortCoords('Singapore')?.name).toMatch(/Singapore/);
    expect(findPortCoords('fujairah')?.name).toMatch(/Fujairah/);
  });

  it('resolves SE-Asia ports (from the mock set or the supplemental list) to coordinates', () => {
    const kerteh = findPortCoords('Kerteh'); // 'Kerteh Marine Terminal' in MOCK_PORTS
    expect(kerteh?.name).toMatch(/Kerteh/);
    expect(typeof kerteh?.lat).toBe('number');

    const klang = findPortCoords('Port Klang'); // supplemental
    expect(klang).not.toBeNull();
    expect(typeof klang?.lon).toBe('number');
  });

  it('returns null for an unknown port', () => {
    expect(findPortCoords('Atlantis')).toBeNull();
    expect(findPortCoords('')).toBeNull();
  });
});

describe('haversineNm', () => {
  it('computes a plausible great-circle distance', () => {
    const sg = { lat: 1.26, lon: 103.82 };
    const fuj = { lat: 25.12, lon: 56.33 };
    const d = haversineNm(sg, fuj);
    expect(d).toBeGreaterThan(2800);
    expect(d).toBeLessThan(3300);
  });

  it('is ~0 for identical points', () => {
    expect(haversineNm({ lat: 1, lon: 1 }, { lat: 1, lon: 1 })).toBeCloseTo(0, 3);
  });
});

describe('deterministicPlan (LLM-free fallback)', () => {
  it('produces a real fuel/cost/CO2 recommendation from the physics model', () => {
    const plan = deterministicPlan(VESSEL, {
      departurePort: 'Singapore',
      destinationPort: 'Fujairah',
      cargoLoad: 80,
      speedPreference: 'economic',
    });

    expect(plan.fallback).toBe(true);
    expect(plan.recommendation).toContain('MT Kerteh Venture');
    expect(plan.recommendation).toMatch(/kn/);
    // economic profile -> ~90% of design speed
    const fuelCall = plan.toolCalls.find((c) => c.tool === 'compute_fuel');
    expect(fuelCall).toBeDefined();
    const out = fuelCall!.output as { speedKnots: number; fuelTonnes: number; co2Tonnes: number };
    expect(out.speedKnots).toBeCloseTo(13.1, 1);
    expect(out.fuelTonnes).toBeGreaterThan(0);
    expect(out.co2Tonnes).toBeGreaterThan(0);
  });

  it('picks the max-speed profile for a "fast" preference', () => {
    const eco = deterministicPlan(VESSEL, { departurePort: 'Singapore', destinationPort: 'Fujairah', speedPreference: 'economic' });
    const fast = deterministicPlan(VESSEL, { departurePort: 'Singapore', destinationPort: 'Fujairah', speedPreference: 'fast' });
    const ecoSpeed = (eco.toolCalls.find((c) => c.tool === 'compute_fuel')!.output as { speedKnots: number }).speedKnots;
    const fastSpeed = (fast.toolCalls.find((c) => c.tool === 'compute_fuel')!.output as { speedKnots: number }).speedKnots;
    expect(fastSpeed).toBeGreaterThan(ecoSpeed);
  });

  it('degrades gracefully when a port is unknown', () => {
    const plan = deterministicPlan(VESSEL, { departurePort: 'Atlantis', destinationPort: 'Fujairah' });
    expect(plan.fallback).toBe(true);
    expect(plan.recommendation).toMatch(/distance unavailable/i);
  });
});
