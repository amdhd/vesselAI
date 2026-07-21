import { Router, Request, Response } from 'express';
import { MOCK_ACTIVE_VOYAGES, getVoyagesByVesselId } from '../mock/voyages';
import { MOCK_VESSELS } from '../mock/vessels';
import { MOCK_WEATHER_ROUTES, getRouteWeather } from '../mock/weatherRoutes';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { aiLimiter } from '../middleware/rateLimiter';
import { requireVessel, resolveFleetVessel, requireFleetAccess, canAccessVessel } from '../lib/tenant';
import {
  OptimizeRouteSchema,
  CalculateSpeedSchema,
  FuelAnalysisSchema,
  PredictEtaSchema,
  GenerateAgentMessageSchema,
} from '../schemas';
import { computeFuelConsumption, buildSpeedPowerCurve, computeAdmiraltyCoefficient } from '../lib/fuelModel';
import { generateJson } from '../services/aiService';
import { runVoyageAgent, AgentVessel } from '../services/voyageAgent';

const router = Router();

// POST /api/voyage/optimize-route
router.post('/optimize-route', authenticate, aiLimiter, validate(OptimizeRouteSchema), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const {
    vesselId,
    departurePort,
    destinationPort,
    cargoLoad = 80,
    speedPreference = 'economic',
  } = req.body;

  const vessel = resolveFleetVessel(req, vesselId);
  if (!vessel) {
    res.status(403).json({ error: 'No accessible vessel for your fleet' });
    return;
  }
  const weatherRoute = getRouteWeather(departurePort, destinationPort) ||
    MOCK_WEATHER_ROUTES.find(r =>
      r.from.toLowerCase().includes((departurePort || '').toLowerCase()) ||
      r.to.toLowerCase().includes((destinationPort || '').toLowerCase())
    ) ||
    MOCK_WEATHER_ROUTES[0];

  const weatherSummary = {
    overallRisk: weatherRoute.overallRisk,
    warnings: weatherRoute.waypoints
      .filter(w => w.warning)
      .map(w => ({ location: w.name, warning: w.warning })),
    avgWindSpeed: Math.round(
      weatherRoute.waypoints.reduce((sum, w) => sum + w.windSpeed, 0) / weatherRoute.waypoints.length
    ),
    maxWaveHeight: Math.max(...weatherRoute.waypoints.map(w => w.waveHeight)),
    recommendations: weatherRoute.recommendations,
  };

  const directRouteDistance = weatherRoute.totalDistance;
  const directSpeed = speedPreference === 'fast' ? vessel.maxSpeed * 0.9 : vessel.designSpeed;
  const directHours = directRouteDistance / directSpeed;

  // Layer 2 + 3: compute fuel for direct route using Admiralty + speed-power model
  const directFc = computeFuelConsumption(vessel, directSpeed, cargoLoad);
  const directFuel = Math.round((directHours / 24) * directFc.fuelTonnesPerDay);
  const directCost = Math.round(directFuel * 620);
  const directCo2 = Math.round(directFuel * 3.151); // VLSFO CO2 factor per IMO MEPC.308(73)
  const directEta = new Date(Date.now() + directHours * 3600 * 1000).toISOString();
  const aiHours = directHours * 1.06;
  const aiEta = new Date(Date.now() + aiHours * 3600 * 1000).toISOString();

  // Waypoint geodata (lat/lng/weather) comes from the vetted weather-route
  // fixtures, never from the LLM — coordinates are the kind of thing a model
  // can plausibly hallucinate, and the frontend map needs them to be real.
  const buildWaypoints = (source: typeof weatherRoute.waypoints, totalHours: number) =>
    source.map((w, i) => ({
      id: `wp-${i}`,
      lat: w.lat,
      lng: w.lon,
      name: w.name,
      eta: new Date(Date.now() + (totalHours * (i + 1)) / source.length * 3600 * 1000).toISOString(),
      weather: {
        windSpeed: w.windSpeed,
        waveHeight: w.waveHeight,
        current: w.currentSpeed,
        description: w.weatherCondition,
      },
    }));
  const directWaypoints = buildWaypoints(weatherRoute.waypoints, directHours);
  const aiWaypoints = buildWaypoints(weatherRoute.waypoints.slice(0, 5), aiHours);

  const fallbackCore = {
    directRoute: { distance: directRouteDistance, fuel: directFuel, cost: directCost, co2: directCo2, eta: directEta },
    aiRoute: {
      distance: Math.round(directRouteDistance * 1.04),
      fuel: Math.round(directFuel * 0.88),
      cost: Math.round(directCost * 0.88),
      co2: Math.round(directCo2 * 0.88),
      eta: aiEta,
      savings: Math.round(directFuel * 0.12),
      costSavings: Math.round(directCost * 0.12),
      reasoning:
        `AI route optimization for ${vessel.name} (${vessel.type}) recommends a slightly longer southern deviation to avoid the active storm system near Sri Lanka, resulting in 12% fuel savings. ` +
        `Weather routing analysis detected Beaufort Force 8-9 conditions along the direct route. ` +
        `The optimized path reduces crew fatigue risk, avoids potential cargo shifting, and improves arrival reliability. ` +
        `Total voyage cost is reduced by $${Math.round(directCost * 0.12).toLocaleString()} despite the additional distance.`,
    },
  };

  const core = await generateJson(res, {
    system: `You are a maritime route optimization AI for VesselMind. Analyze vessel data and weather to recommend optimal routes. Always respond with valid JSON only, no markdown.`,
    prompt: `Optimize route for vessel: ${vessel.name} (${vessel.type}, ${vessel.dwt} DWT)
From: ${departurePort || weatherRoute.from} to ${destinationPort || weatherRoute.to}
Cargo load: ${cargoLoad}%
Speed preference: ${speedPreference}
Direct route distance: ${directRouteDistance} nm
Weather along route: ${JSON.stringify(weatherSummary)}

Respond with JSON only (no markdown): {
  "directRoute": {"distance": number, "fuel": number, "cost": number, "co2": number, "eta": "ISO date string"},
  "aiRoute": {"distance": number, "fuel": number, "cost": number, "co2": number, "eta": "ISO date string", "savings": number, "costSavings": number, "reasoning": "3-4 sentences explaining the AI recommendation"}
}`,
    fallback: fallbackCore,
    onError: (error) => console.error('Route optimization Claude error:', error),
  });

  res.json({
    directRoute: { ...core.directRoute, waypoints: directWaypoints },
    aiRoute: { ...core.aiRoute, waypoints: aiWaypoints },
  });
});

// POST /api/voyage/agent-plan
// Multi-step agentic voyage planner: Claude calls get_vessel_specs / get_route_info /
// get_marine_weather / compute_fuel across several steps, then recommends a speed.
router.post('/agent-plan', authenticate, aiLimiter, validate(OptimizeRouteSchema), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { vesselId, departurePort, destinationPort, cargoLoad, speedPreference } = req.body;
  if (!departurePort || !destinationPort) {
    res.status(400).json({ error: 'departurePort and destinationPort are required' });
    return;
  }
  const vessel = resolveFleetVessel(req, vesselId);
  if (!vessel) {
    res.status(403).json({ error: 'No accessible vessel for your fleet' });
    return;
  }
  const plan = await runVoyageAgent(vessel as AgentVessel, { departurePort, destinationPort, cargoLoad, speedPreference });
  if (plan.fallback) res.setHeader('X-AI-Fallback', 'true');
  res.json(plan);
});

// POST /api/voyage/agent-plan/stream
// Same agentic planner as /agent-plan, but streams the reasoning trace over SSE:
// a `model` tick when each step begins, a `tool` event as each tool resolves,
// then a final `done` event carrying the recommendation + authoritative trace.
// Lets the UI render tool calls live instead of blocking on the whole ~30s run.
router.post('/agent-plan/stream', authenticate, aiLimiter, validate(OptimizeRouteSchema), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { vesselId, departurePort, destinationPort, cargoLoad, speedPreference } = req.body;
  // Validate + tenant-resolve BEFORE switching to SSE, so failures are clean JSON.
  if (!departurePort || !destinationPort) {
    res.status(400).json({ error: 'departurePort and destinationPort are required' });
    return;
  }
  const vessel = resolveFleetVessel(req, vesselId);
  if (!vessel) {
    res.status(403).json({ error: 'No accessible vessel for your fleet' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  try {
    const plan = await runVoyageAgent(
      vessel as AgentVessel,
      { departurePort, destinationPort, cargoLoad, speedPreference },
      (ev) => send(ev)
    );
    send({ type: 'done', ...plan });
  } catch (err) {
    console.error('[voyage-agent] stream error:', err instanceof Error ? err.message : err);
    send({ type: 'error', error: 'Agent run failed' });
  }
  res.write('data: [DONE]\n\n');
  res.end();
});

// GET /api/voyage/history/:vesselId
router.get('/history/:vesselId', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const { vesselId } = req.params;
  if (!requireVessel(req, res, vesselId)) return;
  const voyages = getVoyagesByVesselId(vesselId);
  // Frontend VoyageHistoryRecord wants a single `route` string and
  // non-nullable numeric fields; the mock fixtures split departure/
  // destination ports and leave those fields null until a voyage completes.
  res.json(
    voyages
      .filter(v => v.status === 'completed')
      .map(v => ({
        id: v.id,
        vesselId: v.vesselId,
        route: `${v.departurePort} → ${v.destinationPort}`,
        departureDate: v.departureDate,
        arrivalDate: v.arrivalDate,
        plannedFuel: v.plannedFuel,
        actualFuel: v.actualFuel ?? v.plannedFuel,
        savings: v.savings ?? 0,
        ciiImpact: v.ciiImpact ?? 0,
      }))
  );
});

// POST /api/voyage/calculate-speed
router.post('/calculate-speed', authenticate, validate(CalculateSpeedSchema), (req: AuthenticatedRequest, res: Response) => {
  const { vesselId, targetSpeed, cargoLoad = 80, trimMetres = 0 } = req.body;
  const vessel = resolveFleetVessel(req, vesselId);
  if (!vessel) {
    res.status(403).json({ error: 'No accessible vessel for your fleet' });
    return;
  }

  // Layer 2 + 3: build full speed-power curve using Admiralty Coefficient model
  const speedCurve = buildSpeedPowerCurve(vessel, cargoLoad, trimMetres, targetSpeed);

  res.json({
    vessel: {
      id: vessel.id,
      name: vessel.name,
      designSpeed: vessel.designSpeed,
      admiraltyCoeff: Math.round(computeAdmiraltyCoefficient(vessel) * 10) / 10,
    },
    inputs: { cargoLoad, trimMetres },
    speedCurve,
  });
});

// GET /api/voyage/active/:fleetId
router.get('/active/:fleetId', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const { fleetId } = req.params;
  if (!requireFleetAccess(req, res, fleetId)) return;

  const activeVoyages = MOCK_ACTIVE_VOYAGES
    .filter(voyage => canAccessVessel(req, voyage.vesselId))
    .map(voyage => {
    const vessel = MOCK_VESSELS.find(v => v.id === voyage.vesselId);
    return {
      ...voyage,
      vessel: vessel
        ? {
            id: vessel.id,
            name: vessel.name,
            type: vessel.type,
            currentLat: vessel.currentLat,
            currentLon: vessel.currentLon,
            currentSpeed: vessel.currentSpeed,
          }
        : null,
    };
  });

  res.json({ fleetId, activeVoyages });
});

// POST /api/voyage/predict-eta
router.post('/predict-eta', authenticate, aiLimiter, validate(PredictEtaSchema), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { vesselId, voyageId, currentSpeed, weatherConditions } = req.body;

  const vessel = resolveFleetVessel(req, vesselId);
  if (!vessel) {
    res.status(403).json({ error: 'No accessible vessel for your fleet' });
    return;
  }
  // Only consider voyages belonging to a vessel in the caller's fleet.
  const voyage =
    MOCK_ACTIVE_VOYAGES.find(v => v.id === voyageId && canAccessVessel(req, v.vesselId)) ||
    MOCK_ACTIVE_VOYAGES.find(v => canAccessVessel(req, v.vesselId));

  if (!voyage) {
    res.status(404).json({ error: 'Active voyage not found' });
    return;
  }

  // `||` (not `??`) on purpose: a currentSpeed of 0 (stopped vessel) must fall
  // through to a non-zero planned speed, otherwise the ETA below divides by
  // zero and produces an invalid date.
  const speed = currentSpeed || voyage.actualSpeed || voyage.plannedSpeed;
  const remainingDistance = voyage.plannedDistance * 0.4; // Estimate 40% remaining
  const remainingHours = remainingDistance / speed;
  const etaBasic = new Date(Date.now() + remainingHours * 3600 * 1000).toISOString();

  const mockEta = {
    basicEta: etaBasic,
    aiEta: new Date(Date.now() + remainingHours * 3600 * 1000 * 1.05).toISOString(),
    confidence: 87,
    factors: [
      'Current speed of ' + speed.toFixed(1) + ' knots is within planned range',
      'Weather conditions show moderate seas ahead',
      'Port congestion at destination may add 6-8 hours',
      'Tidal window at destination favorable for planned arrival',
    ],
    recommendation: 'Maintain current speed to achieve optimal berth window. Reduce to 12 knots near destination to avoid demurrage.',
  };

  const result = await generateJson(res, {
    system: 'You are a maritime voyage optimization AI. Predict ETA based on voyage data. Respond with valid JSON only.',
    prompt: `Predict ETA for vessel ${vessel.name}:
Current speed: ${speed} knots
Remaining distance: ~${remainingDistance} nm
Current conditions: ${JSON.stringify(weatherConditions || { risk: 'MEDIUM' })}
Basic ETA: ${etaBasic}

Return JSON: {"basicEta": "ISO", "aiEta": "ISO", "confidence": number, "factors": ["string"], "recommendation": "string"}`,
    maxTokens: 800,
    fallback: mockEta,
    onError: (error) => console.error('ETA prediction error:', error),
  });
  res.json(result);
});

// POST /api/voyage/generate-agent-message
router.post('/generate-agent-message', authenticate, aiLimiter, validate(GenerateAgentMessageSchema), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { vesselId, voyageId, portName, messageType = 'pre-arrival', additionalInfo } = req.body;

  const vessel = resolveFleetVessel(req, vesselId);
  if (!vessel) {
    res.status(403).json({ error: 'No accessible vessel for your fleet' });
    return;
  }
  const voyage =
    MOCK_ACTIVE_VOYAGES.find(v => v.id === voyageId && canAccessVessel(req, v.vesselId)) ||
    MOCK_ACTIVE_VOYAGES.find(v => canAccessVessel(req, v.vesselId));

  const mockMessage = {
    subject: `PRE-ARRIVAL NOTIFICATION - ${vessel.name} - ${portName || 'Port Fujairah'}`,
    body: `Dear Port Agent,

We are pleased to inform you of the anticipated arrival of the following vessel:

VESSEL PARTICULARS:
Name: ${vessel.name}
IMO Number: ${vessel.imoNumber}
Type: ${vessel.type}
Flag: ${vessel.flag}
GRT/DWT: ${vessel.dwt} MT DWT

VOYAGE DETAILS:
Last Port: ${voyage?.departurePort || 'Singapore'}
Next Port (ETA): ${portName || 'Port Fujairah'}
ETA: ${voyage ? new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString() : 'TBD'}
Draft Arrival (F/A): 18.5m / 20.1m
Cargo: Crude Oil, ${voyage?.cargoLoad || 285000} MT

REQUIREMENTS:
- Pilotage required
- Bunker barge: 500 MT VLSFO
- Fresh water: 100 MT
- Crew change: Nil

Please confirm berth availability and ETA acceptance.

Best regards,
Operations Department
Petronas Marine Sdn Bhd`,
    recipient: 'Port Agent',
    type: messageType,
  };

  const result = await generateJson(res, {
    system: 'You are a maritime operations assistant. Draft professional port agent communications for tanker vessels. Return JSON with subject and body fields only.',
    prompt: `Draft a ${messageType} message for vessel ${vessel.name} (${vessel.type}, ${vessel.dwt} DWT, IMO: ${vessel.imoNumber}) arriving at ${portName || 'Port Fujairah'}.
Cargo: ${voyage?.cargoLoad || 285000} MT crude oil from ${voyage?.departurePort || 'Singapore'}.
${additionalInfo ? `Additional info: ${additionalInfo}` : ''}
Return JSON: {"subject": "string", "body": "string"}`,
    maxTokens: 1000,
    fallback: mockMessage,
    onError: (error) => console.error('Agent message generation error:', error),
  });
  res.json({ ...result, type: messageType, recipient: 'Port Agent' });
});

// POST /api/voyage/fuel-analysis
// Returns the detailed Layer 2 + 3 breakdown for a single operating point.
router.post('/fuel-analysis', authenticate, validate(FuelAnalysisSchema), (req: AuthenticatedRequest, res: Response) => {
  const { vesselId, speedKnots, cargoLoad = 80, trimMetres = 0 } = req.body;
  const vessel = resolveFleetVessel(req, vesselId);
  if (!vessel) {
    res.status(403).json({ error: 'No accessible vessel for your fleet' });
    return;
  }

  const result = computeFuelConsumption(vessel, speedKnots, cargoLoad, trimMetres);

  res.json({
    vessel: { id: vessel.id, name: vessel.name, type: vessel.type },
    inputs: { speedKnots, cargoLoad, trimMetres },
    layer2: {
      admiraltyCoeff: result.admiraltyCoeff,
      displacementTonnes: result.displacementTonnes,
      idealShaftPowerKw: result.idealShaftPowerKw,
    },
    layer3: {
      foulingFactor: result.foulingFactor,
      trimFactor: result.trimFactor,
      actualShaftPowerKw: result.actualShaftPowerKw,
      powerLimited: result.powerLimited,
      loadFactor: result.loadFactor,
      sfocGPerKwh: result.sfocGPerKwh,
    },
    output: {
      fuelTonnesPerHour: result.fuelTonnesPerHour,
      fuelTonnesPerDay: result.fuelTonnesPerDay,
      fuelTonnesPerNm: result.fuelTonnesPerNm,
      co2TonnesPerDay: Math.round(result.fuelTonnesPerDay * 3.151 * 100) / 100,
      costPerDayUsd: Math.round(result.fuelTonnesPerDay * 620),
    },
  });
});

export default router;
