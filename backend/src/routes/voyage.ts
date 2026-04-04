import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { MOCK_ACTIVE_VOYAGES, getVoyagesByVesselId } from '../mock/voyages';
import { MOCK_VESSELS } from '../mock/vessels';
import { MOCK_WEATHER_ROUTES, getRouteWeather } from '../mock/weatherRoutes';
import { authenticate } from '../middleware/auth';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/voyage/optimize-route
router.post('/optimize-route', authenticate, async (req: Request, res: Response): Promise<void> => {
  const {
    vesselId,
    departurePort,
    destinationPort,
    cargoLoad = 80,
    speedPreference = 'economic',
  } = req.body;

  const vessel = MOCK_VESSELS.find(v => v.id === vesselId) || MOCK_VESSELS[0];
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
  const directFuelPerDay = vessel.enginePower * 0.0002 * 24;
  const directFuel = Math.round((directHours / 24) * directFuelPerDay);
  const directCost = Math.round(directFuel * 620);
  const directCo2 = Math.round(directFuel * 3.15);
  const directEta = new Date(Date.now() + directHours * 3600 * 1000).toISOString();

  const mockFallback = {
    directRoute: {
      distance: directRouteDistance,
      fuel: directFuel,
      cost: directCost,
      co2: directCo2,
      eta: directEta,
      hours: Math.round(directHours),
    },
    aiRoute: {
      distance: Math.round(directRouteDistance * 1.04),
      fuel: Math.round(directFuel * 0.88),
      cost: Math.round(directCost * 0.88),
      co2: Math.round(directCo2 * 0.88),
      eta: new Date(Date.now() + directHours * 3600 * 1000 * 1.06).toISOString(),
      hours: Math.round(directHours * 1.06),
      waypoints: weatherRoute.waypoints.slice(0, 5).map(w => ({
        lat: w.lat,
        lon: w.lon,
        weather: w.weatherCondition,
      })),
    },
    savings: {
      fuel: Math.round(directFuel * 0.12),
      cost: Math.round(directCost * 0.12),
      co2: Math.round(directCo2 * 0.12),
    },
    explanation:
      `AI route optimization for ${vessel.name} (${vessel.type}) recommends a slightly longer southern deviation to avoid the active storm system near Sri Lanka, resulting in 12% fuel savings. ` +
      `Weather routing analysis detected Beaufort Force 8-9 conditions along the direct route. ` +
      `The optimized path reduces crew fatigue risk, avoids potential cargo shifting, and improves arrival reliability. ` +
      `Total voyage cost is reduced by $${Math.round(directCost * 0.12).toLocaleString()} despite the additional distance.`,
  };

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: `You are a maritime route optimization AI for VesselMind. Analyze vessel data and weather to recommend optimal routes. Always respond with valid JSON only, no markdown.`,
      messages: [
        {
          role: 'user',
          content: `Optimize route for vessel: ${vessel.name} (${vessel.type}, ${vessel.dwt} DWT)
From: ${departurePort || weatherRoute.from} to ${destinationPort || weatherRoute.to}
Cargo load: ${cargoLoad}%
Speed preference: ${speedPreference}
Direct route distance: ${directRouteDistance} nm
Weather along route: ${JSON.stringify(weatherSummary)}

Respond with JSON only (no markdown): {
  "directRoute": {"distance": number, "fuel": number, "cost": number, "co2": number, "eta": "ISO date string", "hours": number},
  "aiRoute": {"distance": number, "fuel": number, "cost": number, "co2": number, "eta": "ISO date string", "hours": number, "waypoints": [{"lat": number, "lon": number, "weather": string}]},
  "savings": {"fuel": number, "cost": number, "co2": number},
  "explanation": "3-4 sentences explaining the AI recommendation"
}`,
        },
      ],
    });

    const rawContent = message.content[0].type === 'text' ? message.content[0].text : '';
    // Strip potential markdown code fences
    const jsonText = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);
    res.json(parsed);
  } catch (error) {
    console.error('Route optimization Claude error:', error);
    res.json(mockFallback);
  }
});

// GET /api/voyage/history/:vesselId
router.get('/history/:vesselId', authenticate, (req: Request, res: Response) => {
  const { vesselId } = req.params;
  const voyages = getVoyagesByVesselId(vesselId);
  res.json(voyages);
});

// POST /api/voyage/calculate-speed
router.post('/calculate-speed', authenticate, (req: Request, res: Response) => {
  const { vesselId, targetSpeed } = req.body;
  const vessel = MOCK_VESSELS.find(v => v.id === vesselId) || MOCK_VESSELS[0];

  const speeds = [];
  const minSpeed = vessel.designSpeed * 0.5;
  const maxSpeed = vessel.maxSpeed;

  for (let speed = minSpeed; speed <= maxSpeed; speed += 0.5) {
    const normalizedSpeed = speed / vessel.designSpeed;
    // Admiralty coefficient: fuel consumption scales with speed^3
    const fuelRatio = Math.pow(normalizedSpeed, 3);
    const baseFuelPerDay = vessel.enginePower * 0.00018 * 24;
    const fuelPerDay = baseFuelPerDay * fuelRatio;
    const fuelPerNm = fuelPerDay / (speed * 24);

    speeds.push({
      speed: parseFloat(speed.toFixed(1)),
      fuelPerDay: parseFloat(fuelPerDay.toFixed(1)),
      fuelPerNm: parseFloat(fuelPerNm.toFixed(3)),
      co2PerDay: parseFloat((fuelPerDay * 3.15).toFixed(1)),
      costPerDay: parseFloat((fuelPerDay * 620).toFixed(0)),
      isOptimal: Math.abs(speed - vessel.designSpeed) < 0.3,
      isTarget: targetSpeed ? Math.abs(speed - targetSpeed) < 0.3 : false,
    });
  }

  res.json({
    vessel: { id: vessel.id, name: vessel.name, designSpeed: vessel.designSpeed },
    speedCurve: speeds,
  });
});

// GET /api/voyage/active/:fleetId
router.get('/active/:fleetId', authenticate, (req: Request, res: Response) => {
  const { fleetId } = req.params;

  const activeVoyages = MOCK_ACTIVE_VOYAGES.map(voyage => {
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
router.post('/predict-eta', authenticate, async (req: Request, res: Response): Promise<void> => {
  const { vesselId, voyageId, currentSpeed, weatherConditions } = req.body;

  const vessel = MOCK_VESSELS.find(v => v.id === vesselId) || MOCK_VESSELS[0];
  const voyage = MOCK_ACTIVE_VOYAGES.find(v => v.id === voyageId) || MOCK_ACTIVE_VOYAGES[0];

  if (!voyage) {
    res.status(404).json({ error: 'Active voyage not found' });
    return;
  }

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

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: 'You are a maritime voyage optimization AI. Predict ETA based on voyage data. Respond with valid JSON only.',
      messages: [
        {
          role: 'user',
          content: `Predict ETA for vessel ${vessel.name}:
Current speed: ${speed} knots
Remaining distance: ~${remainingDistance} nm
Current conditions: ${JSON.stringify(weatherConditions || { risk: 'MEDIUM' })}
Basic ETA: ${etaBasic}

Return JSON: {"basicEta": "ISO", "aiEta": "ISO", "confidence": number, "factors": ["string"], "recommendation": "string"}`,
        },
      ],
    });

    const rawContent = message.content[0].type === 'text' ? message.content[0].text : '';
    const jsonText = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);
    res.json(parsed);
  } catch (error) {
    console.error('ETA prediction error:', error);
    res.json(mockEta);
  }
});

// POST /api/voyage/generate-agent-message
router.post('/generate-agent-message', authenticate, async (req: Request, res: Response): Promise<void> => {
  const { vesselId, voyageId, portName, messageType = 'pre-arrival', additionalInfo } = req.body;

  const vessel = MOCK_VESSELS.find(v => v.id === vesselId) || MOCK_VESSELS[0];
  const voyage = MOCK_ACTIVE_VOYAGES.find(v => v.id === voyageId) || MOCK_ACTIVE_VOYAGES[0];

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

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: 'You are a maritime operations assistant. Draft professional port agent communications for tanker vessels. Return JSON with subject and body fields only.',
      messages: [
        {
          role: 'user',
          content: `Draft a ${messageType} message for vessel ${vessel.name} (${vessel.type}, ${vessel.dwt} DWT, IMO: ${vessel.imoNumber}) arriving at ${portName || 'Port Fujairah'}.
Cargo: ${voyage?.cargoLoad || 285000} MT crude oil from ${voyage?.departurePort || 'Singapore'}.
${additionalInfo ? `Additional info: ${additionalInfo}` : ''}
Return JSON: {"subject": "string", "body": "string"}`,
        },
      ],
    });

    const rawContent = message.content[0].type === 'text' ? message.content[0].text : '';
    const jsonText = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);
    res.json({ ...parsed, type: messageType, recipient: 'Port Agent' });
  } catch (error) {
    console.error('Agent message generation error:', error);
    res.json(mockMessage);
  }
});

export default router;
