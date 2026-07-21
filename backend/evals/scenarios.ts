import { AgentVessel, AgentParams } from '../src/services/voyageAgent';

// Fixtures for the behavioural (real-model) eval suite. Kept separate from the
// hermetic Tier-1 loop tests so the two never share state.

export const EVAL_VESSEL: AgentVessel = {
  id: 'eval-v1',
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

export interface Scenario {
  id: string;
  description: string;
  params: AgentParams;
  // Whether the ports are resolvable — an unknown port should still converge
  // to a graceful answer rather than crash or fall back.
  expectPortsResolvable: boolean;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'kerteh-singapore-economic',
    description: 'Short SE-Asia leg, economic profile — expect slow-steaming bias.',
    params: { departurePort: 'Kerteh', destinationPort: 'Singapore', cargoLoad: 80, speedPreference: 'economic' },
    expectPortsResolvable: true,
  },
  {
    id: 'kerteh-singapore-fast',
    description: 'Same leg, fast profile — expect a higher recommended speed than the economic run.',
    params: { departurePort: 'Kerteh', destinationPort: 'Singapore', cargoLoad: 80, speedPreference: 'fast' },
    expectPortsResolvable: true,
  },
  {
    id: 'portklang-bintulu-optimal',
    description: 'Longer leg across the South China Sea, optimal profile.',
    params: { departurePort: 'Port Klang', destinationPort: 'Bintulu', cargoLoad: 60, speedPreference: 'optimal' },
    expectPortsResolvable: true,
  },
  {
    id: 'unknown-port',
    description: 'An unrecognised port — the agent should degrade gracefully, not crash.',
    params: { departurePort: 'Atlantis', destinationPort: 'Singapore', cargoLoad: 80, speedPreference: 'economic' },
    expectPortsResolvable: false,
  },
];

// The economic/fast pair used for the cross-scenario monotonicity invariant.
export const SPEED_PAIR = { economic: 'kerteh-singapore-economic', fast: 'kerteh-singapore-fast' } as const;
