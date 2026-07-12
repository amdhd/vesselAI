import { describe, it, expect } from 'vitest';
import { computePortCongestion, levelFromAnchored, AisPoint, PortLike } from './portCongestion';

const PORT: PortLike = { id: 'p1', name: 'Port A', country: 'X', lat: 1.26, lon: 103.82 };
const FAR: PortLike = { id: 'p2', name: 'Port B', country: 'Y', lat: 5.0, lon: 110.0 };

describe('levelFromAnchored', () => {
  it('maps anchored counts to levels', () => {
    expect(levelFromAnchored(0)).toBe('low');
    expect(levelFromAnchored(2)).toBe('low');
    expect(levelFromAnchored(5)).toBe('medium');
    expect(levelFromAnchored(10)).toBe('high');
    expect(levelFromAnchored(20)).toBe('congested');
  });
});

describe('computePortCongestion', () => {
  const positions: AisPoint[] = [
    { latitude: 1.26, longitude: 103.82, sog: 0.2, navStatus: 1 }, // anchored (slow + at anchor)
    { latitude: 1.27, longitude: 103.83, sog: 0.0, navStatus: 5 }, // moored
    { latitude: 1.25, longitude: 103.81, sog: 0.5, navStatus: 0 }, // slow → waiting
    { latitude: 1.28, longitude: 103.8, sog: 0.8, navStatus: 0 }, // slow → waiting
    { latitude: 1.26, longitude: 103.82, sog: 12, navStatus: 0 }, // transiting → not waiting
    { latitude: 5.0, longitude: 110.0, sog: 0, navStatus: 1 }, // near a different port
  ];

  it('counts nearby + anchored vessels and derives the level', () => {
    const [portA] = computePortCongestion(positions, [PORT]);
    expect(portA.vesselsNearby).toBe(5); // 5 within the box; the 6th is at Port B
    expect(portA.vesselsAtAnchor).toBe(4); // 4 stationary; the 12 kn transit excluded
    expect(portA.congestionLevel).toBe('medium'); // 4 → 3..6
    expect(portA.source).toBe('ais-derived');
  });

  it('isolates ports by location', () => {
    const [, portB] = computePortCongestion(positions, [PORT, FAR]);
    expect(portB.vesselsNearby).toBe(1);
    expect(portB.vesselsAtAnchor).toBe(1);
    expect(portB.congestionLevel).toBe('low');
  });

  it('reports low congestion for an empty area', () => {
    const [p] = computePortCongestion([], [PORT]);
    expect(p.vesselsNearby).toBe(0);
    expect(p.vesselsAtAnchor).toBe(0);
    expect(p.congestionLevel).toBe('low');
    expect(p.avgWaitingTime).toBe(0);
  });
});
