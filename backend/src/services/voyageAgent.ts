import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { anthropic, AI_MODEL } from './aiService';
import { SYSTEM_GUARDRAILS } from '../lib/aiGuard';
import { computeFuelConsumption, VesselFuelParams } from '../lib/fuelModel';
import { getObservationsNear } from './weatherPipeline';
import { fetchObservation } from '../lib/openMeteo';
import { MOCK_PORTS } from '../mock/ports';

// Match the constants used by the deterministic optimizer so the agent and the
// classic route return comparable numbers.
const VLSFO_PRICE_PER_TONNE = 620;
const CO2_FACTOR_VLSFO = 3.151;
const MAX_STEPS = 8; // hard cap on agentic loop iterations

const round = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;

// The subset of a vessel the agent's tools need (a MockVessel satisfies it).
export type AgentVessel = VesselFuelParams & {
  id: string;
  name: string;
  type: string;
  fuelCapacity: number;
};

export interface AgentParams {
  departurePort: string;
  destinationPort: string;
  cargoLoad?: number;
  speedPreference?: string;
}

export interface ToolCallTrace {
  tool: string;
  input: unknown;
  output: unknown;
}

export interface AgentPlan {
  recommendation: string;
  steps: number;
  toolCalls: ToolCallTrace[];
  fallback: boolean;
  incomplete?: boolean;
}

// Progress events emitted live as the agent works, so a caller (e.g. an SSE
// endpoint) can stream the reasoning trace instead of blocking for the whole run.
export type AgentStreamEvent =
  | { type: 'model'; step: number } // a model turn started (a "thinking" tick)
  | { type: 'tool'; index: number; tool: string; input: unknown; output: unknown };

// ── Port geo lookup ───────────────────────────────────────────────────────────
interface PortCoords {
  name: string;
  lat: number;
  lon: number;
}

// A few SE-Asia ports the app references that aren't in MOCK_PORTS.
const EXTRA_PORTS: PortCoords[] = [
  { name: 'Port Klang', lat: 3.0, lon: 101.39 },
  { name: 'Kerteh', lat: 4.53, lon: 103.44 },
  { name: 'Bintulu', lat: 3.26, lon: 113.06 },
  { name: 'Port Dickson', lat: 2.52, lon: 101.8 },
];

export function findPortCoords(query: string): PortCoords | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const mock = MOCK_PORTS.find(
    (p) => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase().replace(/^port of /, ''))
  );
  if (mock) return { name: mock.name, lat: mock.lat, lon: mock.lon };
  const extra = EXTRA_PORTS.find((p) => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase()));
  return extra ?? null;
}

/** Great-circle distance in nautical miles. */
export function haversineNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R_NM = 3440.065;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.sqrt(h));
}

// ── Tool definitions (JSON schema Claude sees) ────────────────────────────────
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_vessel_specs',
    description: "Get the voyage vessel's key specs (deadweight, design/max speed, fuel capacity).",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_route_info',
    description: 'Get the coordinates of the departure and destination ports and the great-circle distance in nautical miles between them.',
    input_schema: {
      type: 'object',
      properties: {
        departurePort: { type: 'string' },
        destinationPort: { type: 'string' },
      },
      required: ['departurePort', 'destinationPort'],
    },
  },
  {
    name: 'get_marine_weather',
    description: 'Get real marine weather (wave height, wind speed, current) at a coordinate, from the ingestion pipeline if available, otherwise a live fetch.',
    input_schema: {
      type: 'object',
      properties: {
        latitude: { type: 'number' },
        longitude: { type: 'number' },
      },
      required: ['latitude', 'longitude'],
    },
  },
  {
    name: 'compute_fuel',
    description: 'Compute physics-based fuel burn, cost (USD), CO2 (t) and ETA for the vessel at a given speed and cargo load over a distance.',
    input_schema: {
      type: 'object',
      properties: {
        speedKnots: { type: 'number' },
        cargoLoadPct: { type: 'number' },
        distanceNm: { type: 'number' },
      },
      required: ['speedKnots', 'cargoLoadPct', 'distanceNm'],
    },
  },
];

const routeInfoInput = z.object({ departurePort: z.string(), destinationPort: z.string() });
const weatherInput = z.object({ latitude: z.number(), longitude: z.number() });
const fuelInput = z.object({
  speedKnots: z.number().positive(),
  cargoLoadPct: z.number().min(0).max(100),
  distanceNm: z.number().positive(),
});

interface ToolContext {
  vessel: AgentVessel;
}

function fuelForLeg(vessel: AgentVessel, speedKnots: number, cargoLoadPct: number, distanceNm: number) {
  const fc = computeFuelConsumption(vessel, speedKnots, cargoLoadPct);
  const etaHours = distanceNm / speedKnots;
  const fuelTonnes = round((etaHours / 24) * fc.fuelTonnesPerDay, 1);
  return {
    speedKnots,
    distanceNm,
    etaHours: round(etaHours, 1),
    fuelTonnesPerDay: fc.fuelTonnesPerDay,
    fuelTonnes,
    fuelCostUsd: Math.round(fuelTonnes * VLSFO_PRICE_PER_TONNE),
    co2Tonnes: round(fuelTonnes * CO2_FACTOR_VLSFO, 1),
    powerLimited: fc.powerLimited,
  };
}

/**
 * Execute a tool the agent requested. Tenant isolation is enforced here: the
 * vessel is the caller's fleet-resolved vessel, so even a prompt-injected agent
 * can't reach another fleet's data.
 */
async function execTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<unknown> {
  switch (name) {
    case 'get_vessel_specs': {
      const v = ctx.vessel;
      return {
        id: v.id,
        name: v.name,
        type: v.type,
        dwt: v.dwt,
        designSpeedKn: v.designSpeed,
        maxSpeedKn: v.maxSpeed,
        fuelCapacityTonnes: v.fuelCapacity,
      };
    }
    case 'get_route_info': {
      const { departurePort, destinationPort } = routeInfoInput.parse(rawInput);
      const dep = findPortCoords(departurePort);
      const dest = findPortCoords(destinationPort);
      if (!dep || !dest) {
        return { error: `Unknown port(s): ${[!dep && departurePort, !dest && destinationPort].filter(Boolean).join(', ')}` };
      }
      return {
        departure: { name: dep.name, latitude: dep.lat, longitude: dep.lon },
        destination: { name: dest.name, latitude: dest.lat, longitude: dest.lon },
        distanceNm: Math.round(haversineNm(dep, dest)),
      };
    }
    case 'get_marine_weather': {
      const { latitude, longitude } = weatherInput.parse(rawInput);
      try {
        const near = await getObservationsNear(latitude, longitude);
        if (near.length) {
          const o = near[0];
          return {
            source: 'ingestion-pipeline',
            observedAt: o.observedAt,
            waveHeightM: o.waveHeight,
            windSpeedKn: o.windSpeed,
            currentSpeedKmh: o.currentSpeed,
            weatherCode: o.weatherCode,
          };
        }
      } catch {
        /* DB unavailable — fall through to a live fetch */
      }
      try {
        const o = await fetchObservation({ latitude, longitude });
        return {
          source: 'live',
          observedAt: o.observedAt,
          waveHeightM: o.waveHeight,
          windSpeedKn: o.windSpeed,
          currentSpeedKmh: o.currentSpeed,
          weatherCode: o.weatherCode,
        };
      } catch {
        return { error: 'Weather data unavailable for this coordinate' };
      }
    }
    case 'compute_fuel': {
      const { speedKnots, cargoLoadPct, distanceNm } = fuelInput.parse(rawInput);
      return fuelForLeg(ctx.vessel, speedKnots, cargoLoadPct, distanceNm);
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

/**
 * Deterministic plan used when the LLM is unavailable (bad key, rate limit,
 * error) — computes a recommendation from the same physics the tools use, so
 * the endpoint always returns a usable answer. Flagged fallback: true.
 */
export function deterministicPlan(vessel: AgentVessel, params: AgentParams): AgentPlan {
  const dep = findPortCoords(params.departurePort);
  const dest = findPortCoords(params.destinationPort);
  const distanceNm = dep && dest ? Math.round(haversineNm(dep, dest)) : null;
  const cargo = params.cargoLoad ?? 80;

  const eco = round(vessel.designSpeed * 0.9);
  const fast = round(Math.min(vessel.maxSpeed * 0.95, vessel.maxSpeed));
  const chosen = params.speedPreference === 'economic' ? eco : params.speedPreference === 'fast' ? fast : vessel.designSpeed;

  const toolCalls: ToolCallTrace[] = [];
  if (distanceNm && dep && dest) {
    toolCalls.push({
      tool: 'get_route_info',
      input: { departurePort: params.departurePort, destinationPort: params.destinationPort },
      output: { departure: dep, destination: dest, distanceNm },
    });
  }

  const leg = distanceNm ? fuelForLeg(vessel, chosen, cargo, distanceNm) : null;
  toolCalls.push({
    tool: 'compute_fuel',
    input: { speedKnots: chosen, cargoLoadPct: cargo, distanceNm: distanceNm ?? 0 },
    output: leg ?? { speedKnots: chosen, fuelTonnesPerDay: computeFuelConsumption(vessel, chosen, cargo).fuelTonnesPerDay },
  });

  const recommendation = leg
    ? `Recommended speed ${chosen} kn (${params.speedPreference ?? 'normal'} profile) for ${vessel.name} on ${params.departurePort} → ${params.destinationPort}: ~${distanceNm} nm, burning ~${leg.fuelTonnes} t VLSFO (~$${leg.fuelCostUsd.toLocaleString()}, ${leg.co2Tonnes} t CO₂), ETA ~${Math.round(leg.etaHours)} h. [Deterministic fallback — AI agent unavailable.]`
    : `Recommended speed ${chosen} kn (${params.speedPreference ?? 'normal'} profile) for ${vessel.name}. Route distance unavailable — port(s) not recognized. [Deterministic fallback — AI agent unavailable.]`;

  return { recommendation, steps: 0, toolCalls, fallback: true };
}

/**
 * Run the agentic loop: Claude plans a voyage by calling the tools above across
 * multiple steps, then returns a recommendation plus the full tool-call trace.
 * Falls back to a deterministic plan on any API failure.
 */
export async function runVoyageAgent(
  vessel: AgentVessel,
  params: AgentParams,
  onEvent?: (ev: AgentStreamEvent) => void
): Promise<AgentPlan> {
  const ctx: ToolContext = { vessel };

  const system =
    `You are a maritime voyage-optimization agent for VesselMind. Recommend the optimal speed for a voyage, ` +
    `using the tools to gather real data before you answer. Work in steps: (1) get_vessel_specs to learn the ` +
    `speed envelope, (2) get_route_info for the distance and endpoint coordinates, (3) get_marine_weather at ` +
    `BOTH endpoints, (4) compute_fuel at two or three candidate speeds. Then recommend ONE speed that balances ` +
    `the "${params.speedPreference ?? 'normal'}" preference against the weather and the fuel/cost/CO2 tradeoff. ` +
    `Cite the specific numbers the tools returned. Keep the final recommendation under six sentences.` +
    SYSTEM_GUARDRAILS;

  const userPrompt =
    `Plan the voyage for ${vessel.name} (${vessel.type}) from ${params.departurePort} to ${params.destinationPort}. ` +
    `Cargo load ${params.cargoLoad ?? 80}%. Speed preference: ${params.speedPreference ?? 'normal'}.`;

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }];
  const toolCalls: ToolCallTrace[] = [];

  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      onEvent?.({ type: 'model', step });
      const resp = await anthropic.messages.create({
        model: AI_MODEL,
        max_tokens: 2048,
        system,
        messages,
        tools: TOOLS,
      });
      messages.push({ role: 'assistant', content: resp.content });

      if (resp.stop_reason !== 'tool_use') {
        const text = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();
        return { recommendation: text || '(no recommendation produced)', steps: step, toolCalls, fallback: false };
      }

      const results: Anthropic.ContentBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type === 'tool_use') {
          let output: unknown;
          try {
            output = await execTool(ctx, block.name, block.input);
          } catch (err) {
            output = { error: err instanceof Error ? err.message : 'tool execution failed' };
          }
          toolCalls.push({ tool: block.name, input: block.input, output });
          onEvent?.({ type: 'tool', index: toolCalls.length, tool: block.name, input: block.input, output });
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(output) });
        }
      }
      messages.push({ role: 'user', content: results });
    }

    return { recommendation: 'The agent did not converge within the step limit.', steps: MAX_STEPS, toolCalls, fallback: false, incomplete: true };
  } catch (err) {
    console.error('[voyage-agent] error, using deterministic fallback:', err instanceof Error ? err.message : err);
    return deterministicPlan(vessel, params);
  }
}
