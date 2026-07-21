import { AgentPlan } from '../src/services/voyageAgent';
import { Scenario } from './scenarios';

// Pure, deterministic graders scored over an AgentPlan (+ scenario). They read
// only the plan's public surface — crucially the toolCalls trace the agent
// already returns — so they need no access to agent internals and are fully
// unit-testable without any API call (see graders.test.ts).

export interface GradeResult {
  name: string;
  pass: boolean;
  detail: string;
}

function toolNames(plan: AgentPlan): string[] {
  return plan.toolCalls.map((t) => t.tool);
}

/** The agent gathered real data before answering: specs, route, weather at both ends, ≥2 speeds. */
export function gradeCalledCoreTools(plan: AgentPlan): GradeResult {
  const tools = toolNames(plan);
  const has = (n: string) => tools.includes(n);
  const weather = tools.filter((t) => t === 'get_marine_weather').length;
  const fuel = tools.filter((t) => t === 'compute_fuel').length;
  const pass = has('get_vessel_specs') && has('get_route_info') && weather >= 2 && fuel >= 2;
  return {
    name: 'gathers data (specs, route, weather×2, fuel×2)',
    pass,
    detail: `specs=${has('get_vessel_specs')} route=${has('get_route_info')} weather=${weather} fuel=${fuel}`,
  };
}

/** The loop finished on the model (not the deterministic fallback) and didn't hit the step cap. */
export function gradeConverged(plan: AgentPlan): GradeResult {
  const pass = plan.fallback === false && !plan.incomplete;
  return {
    name: 'converged on the model (no fallback / not truncated)',
    pass,
    detail: `fallback=${plan.fallback} incomplete=${plan.incomplete ?? false} steps=${plan.steps}`,
  };
}

/** Distinct speeds the agent actually costed via compute_fuel (the recommendation should pick one of these). */
export function candidateSpeeds(plan: AgentPlan): number[] {
  const speeds = plan.toolCalls
    .filter((t) => t.tool === 'compute_fuel')
    .map((t) => (t.input as { speedKnots?: unknown })?.speedKnots)
    .filter((s): s is number => typeof s === 'number');
  return [...new Set(speeds)];
}

/** The great-circle distance from get_route_info appears verbatim in the recommendation. */
export function gradeCitesRouteDistance(plan: AgentPlan): GradeResult {
  const route = plan.toolCalls.find((t) => t.tool === 'get_route_info');
  const distance = (route?.output as { distanceNm?: unknown })?.distanceNm;
  if (typeof distance !== 'number') {
    return { name: 'cites the route distance', pass: false, detail: 'no distanceNm in trace' };
  }
  const pass = plan.recommendation.includes(String(distance));
  return { name: 'cites the route distance', pass, detail: `distanceNm=${distance} present=${pass}` };
}

/** The recommendation names one of the speeds the agent actually computed (grounds the answer in the tools). */
export function gradeRecommendsCandidateSpeed(plan: AgentPlan): GradeResult {
  const speeds = candidateSpeeds(plan);
  const pass = speeds.some((s) => new RegExp(`\\b${s}(\\.\\d+)?\\s*(kn|knot)`, 'i').test(plan.recommendation));
  return {
    name: 'recommends a speed it actually costed',
    pass,
    detail: `candidates=[${speeds.join(', ')}]`,
  };
}

/** Best-effort: the recommended speed in knots, taken as the candidate speed appearing nearest "recommend". */
export function extractRecommendedSpeed(plan: AgentPlan): number | null {
  const speeds = candidateSpeeds(plan);
  if (speeds.length === 0) return null;
  const text = plan.recommendation.toLowerCase();
  const anchor = text.indexOf('recommend');
  let best: { speed: number; dist: number } | null = null;
  for (const s of speeds) {
    const m = new RegExp(`\\b${s}(\\.\\d+)?\\s*(kn|knot)`, 'i').exec(text);
    if (!m) continue;
    const dist = anchor >= 0 ? Math.abs(m.index - anchor) : m.index;
    if (!best || dist < best.dist) best = { speed: s, dist };
  }
  return best?.speed ?? null;
}

/** All per-plan graders that apply to a given scenario. */
export function gradePlan(plan: AgentPlan, scenario: Scenario): GradeResult[] {
  const results = [gradeConverged(plan)];
  if (scenario.expectPortsResolvable) {
    results.push(gradeCalledCoreTools(plan), gradeCitesRouteDistance(plan), gradeRecommendsCandidateSpeed(plan));
  }
  return results;
}
