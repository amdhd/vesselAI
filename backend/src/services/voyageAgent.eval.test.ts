import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runVoyageAgent, AgentVessel } from './voyageAgent';
import { anthropic } from './aiService';

// Tier-1 agent evals: exercise the agentic LOOP mechanics in runVoyageAgent by
// mocking anthropic.messages.create with scripted tool_use / end_turn responses.
// No network, no DB, no API cost — so these run in CI on every push. The scripted
// tool calls use only the pure tools (get_vessel_specs / get_route_info /
// compute_fuel); get_marine_weather is intentionally avoided here because its
// real implementation touches Prisma + Open-Meteo.
//
// Behavioural/quality evals against the real model live in evals/ (opt-in).

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

const PARAMS = { departurePort: 'Kerteh', destinationPort: 'Singapore', cargoLoad: 80, speedPreference: 'economic' };

// Minimal Anthropic.Message-shaped stubs — the agent only reads stop_reason + content.
const toolUse = (name: string, input: unknown, id = 't1') => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id, name, input }],
});
const parallelToolUse = (calls: { name: string; input: unknown; id: string }[]) => ({
  stop_reason: 'tool_use',
  content: calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })),
});
const endTurn = (text: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

function mockModel(...responses: unknown[]) {
  const spy = vi.spyOn(anthropic.messages, 'create');
  responses.forEach((r) => spy.mockResolvedValueOnce(r as never));
  return spy;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('runVoyageAgent — loop mechanics (mocked model)', () => {
  it('executes a requested tool, threads its result back, and returns the recommendation on end_turn', async () => {
    const spy = mockModel(
      toolUse('get_vessel_specs', {}),
      endTurn('Recommend 13 kn for the economic profile.')
    );

    const plan = await runVoyageAgent(VESSEL, PARAMS);

    expect(plan.fallback).toBe(false);
    expect(plan.incomplete).toBeUndefined();
    expect(plan.steps).toBe(2);
    expect(plan.recommendation).toContain('economic profile');

    // The tool actually ran and produced real specs from the passed vessel.
    expect(plan.toolCalls).toHaveLength(1);
    expect(plan.toolCalls[0].tool).toBe('get_vessel_specs');
    expect(plan.toolCalls[0].output).toMatchObject({ id: 'v1', dwt: 115000 });

    // The second model call was handed the tool_result (loop threaded it back).
    expect(spy).toHaveBeenCalledTimes(2);
    const secondCallMessages = (spy.mock.calls[1][0] as any).messages;
    const threaded = secondCallMessages
      .flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))
      .find((b: any) => b?.type === 'tool_result');
    expect(threaded).toBeTruthy();
    expect(threaded.tool_use_id).toBe('t1');
    expect(String(threaded.content)).toContain('115000');
  });

  it('caps the loop at MAX_STEPS and flags it incomplete when the model never stops', async () => {
    // Always ask for a tool, never end the turn.
    const spy = vi.spyOn(anthropic.messages, 'create');
    spy.mockResolvedValue(toolUse('get_vessel_specs', {}) as never);

    const plan = await runVoyageAgent(VESSEL, PARAMS);

    expect(plan.incomplete).toBe(true);
    expect(plan.fallback).toBe(false);
    expect(plan.steps).toBe(8); // MAX_STEPS
    expect(spy).toHaveBeenCalledTimes(8);
  });

  it('falls back to the deterministic plan when the model call throws', async () => {
    const spy = vi.spyOn(anthropic.messages, 'create');
    spy.mockRejectedValue(new Error('rate limited') as never);

    const plan = await runVoyageAgent(VESSEL, PARAMS);

    expect(plan.fallback).toBe(true);
    expect(plan.steps).toBe(0);
    expect(plan.recommendation).toMatch(/deterministic fallback/i);
  });

  it('keeps a prompt-injected tool call scoped to the caller vessel (tenant isolation)', async () => {
    // get_vessel_specs takes no input; even a forged input can only ever return
    // ctx.vessel — the agent can never reach another fleet's vessel through it.
    mockModel(
      toolUse('get_vessel_specs', { vesselId: 'v-belonging-to-another-fleet' }),
      endTurn('done')
    );

    const plan = await runVoyageAgent(VESSEL, PARAMS);

    expect(plan.toolCalls[0].output).toMatchObject({ id: 'v1' });
    expect(JSON.stringify(plan.toolCalls[0].output)).not.toContain('another-fleet');
  });

  it('returns a structured error (not a crash) for a malformed tool input and keeps going', async () => {
    mockModel(
      toolUse('compute_fuel', { speedKnots: -5 }), // fails zod: missing/invalid fields
      endTurn('handled the bad input gracefully')
    );

    const plan = await runVoyageAgent(VESSEL, PARAMS);

    expect(plan.fallback).toBe(false);
    expect(plan.toolCalls[0].tool).toBe('compute_fuel');
    expect(plan.toolCalls[0].output).toHaveProperty('error');
    expect(plan.recommendation).toContain('gracefully');
  });

  it('executes multiple tool_use blocks from one turn and threads all results in a single user message', async () => {
    const spy = mockModel(
      parallelToolUse([
        { name: 'get_vessel_specs', input: {}, id: 'a' },
        { name: 'get_route_info', input: { departurePort: 'Kerteh', destinationPort: 'Singapore' }, id: 'b' },
      ]),
      endTurn('both tools ran')
    );

    const plan = await runVoyageAgent(VESSEL, PARAMS);

    expect(plan.toolCalls).toHaveLength(2);
    expect(plan.toolCalls.map((t) => t.tool)).toEqual(['get_vessel_specs', 'get_route_info']);

    // Both tool_results must arrive batched in ONE user message. (The agent
    // mutates a single messages array by reference across the loop, so inspect
    // the final state and find the user turn that carries the tool_results.)
    const messages = (spy.mock.calls[1][0] as any).messages;
    const resultMessages = messages.filter(
      (m: any) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result')
    );
    expect(resultMessages).toHaveLength(1); // batched, not split across messages
    const results = resultMessages[0].content.filter((b: any) => b.type === 'tool_result');
    expect(results).toHaveLength(2);
    expect(results.map((r: any) => r.tool_use_id).sort()).toEqual(['a', 'b']);
  });
});
