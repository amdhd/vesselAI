import { describe, it, expect } from 'vitest';
import { AgentPlan } from '../src/services/voyageAgent';
import {
  gradeCalledCoreTools,
  gradeConverged,
  gradeCitesRouteDistance,
  gradeRecommendsCandidateSpeed,
  candidateSpeeds,
  extractRecommendedSpeed,
} from './graders';

// A synthetic "good" plan mirroring the shape runVoyageAgent returns on a healthy
// run — lets us unit-test the graders with zero API cost.
function goodPlan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    fallback: false,
    steps: 4,
    recommendation:
      'Recommended speed 12 kn for the economic profile over 195 nm — burns ~49 t VLSFO.',
    toolCalls: [
      { tool: 'get_vessel_specs', input: {}, output: { id: 'v1', dwt: 115000 } },
      { tool: 'get_route_info', input: {}, output: { distanceNm: 195 } },
      { tool: 'get_marine_weather', input: { latitude: 4.5, longitude: 103.4 }, output: { waveHeightM: 0.3 } },
      { tool: 'get_marine_weather', input: { latitude: 1.3, longitude: 103.8 }, output: { waveHeightM: 0.1 } },
      { tool: 'compute_fuel', input: { speedKnots: 12 }, output: { fuelTonnes: 49 } },
      { tool: 'compute_fuel', input: { speedKnots: 14 }, output: { fuelTonnes: 64 } },
    ],
    ...overrides,
  };
}

describe('graders', () => {
  it('passes a healthy plan on all core graders', () => {
    const plan = goodPlan();
    expect(gradeConverged(plan).pass).toBe(true);
    expect(gradeCalledCoreTools(plan).pass).toBe(true);
    expect(gradeCitesRouteDistance(plan).pass).toBe(true);
    expect(gradeRecommendsCandidateSpeed(plan).pass).toBe(true);
  });

  it('fails gradeConverged for a fallback or truncated plan', () => {
    expect(gradeConverged(goodPlan({ fallback: true })).pass).toBe(false);
    expect(gradeConverged(goodPlan({ incomplete: true })).pass).toBe(false);
  });

  it('fails gradeCalledCoreTools when weather/fuel coverage is thin', () => {
    const plan = goodPlan({
      toolCalls: [
        { tool: 'get_vessel_specs', input: {}, output: {} },
        { tool: 'get_route_info', input: {}, output: { distanceNm: 195 } },
        { tool: 'get_marine_weather', input: {}, output: {} }, // only one endpoint
        { tool: 'compute_fuel', input: { speedKnots: 12 }, output: {} }, // only one speed
      ],
    });
    expect(gradeCalledCoreTools(plan).pass).toBe(false);
  });

  it('fails gradeCitesRouteDistance when the distance is absent from the text', () => {
    expect(gradeCitesRouteDistance(goodPlan({ recommendation: 'Go slow, save fuel.' })).pass).toBe(false);
  });

  it('dedupes candidate speeds and extracts the one nearest "recommend"', () => {
    const plan = goodPlan();
    expect(candidateSpeeds(plan)).toEqual([12, 14]);
    expect(extractRecommendedSpeed(plan)).toBe(12);
  });

  it('gradeRecommendsCandidateSpeed rejects a speed never costed', () => {
    const plan = goodPlan({ recommendation: 'Recommended speed 20 kn.' });
    expect(gradeRecommendsCandidateSpeed(plan).pass).toBe(false);
  });
});
