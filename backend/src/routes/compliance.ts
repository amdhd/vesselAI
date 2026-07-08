import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { MOCK_VOYAGES } from '../mock/voyages';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { aiLimiter } from '../middleware/rateLimiter';
import { requireVessel, resolveFleetVessel } from '../lib/tenant';
import { SYSTEM_GUARDRAILS } from '../lib/aiGuard';
import { GenerateMrvReportSchema, ComplianceChatSchema } from '../schemas';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// CII data per vessel
const CII_DATA: {
  [vesselId: string]: {
    rating: string;
    score: number;
    required: number;
    status: string;
    trajectory: { month: string; score: number; required: number }[];
    annualFuel: number;
    annualDistance: number;
    annualCo2: number;
  };
} = {
  'vessel-001': {
    rating: 'B',
    score: 3.82,
    required: 4.20,
    status: 'compliant',
    annualFuel: 22140,
    annualDistance: 52000,
    annualCo2: 69741,
    trajectory: [
      { month: 'Jan', score: 3.95, required: 4.20 },
      { month: 'Feb', score: 3.88, required: 4.20 },
      { month: 'Mar', score: 3.91, required: 4.20 },
      { month: 'Apr', score: 3.79, required: 4.20 },
      { month: 'May', score: 3.85, required: 4.20 },
      { month: 'Jun', score: 3.82, required: 4.20 },
      { month: 'Jul', score: 3.76, required: 4.20 },
      { month: 'Aug', score: 3.80, required: 4.20 },
      { month: 'Sep', score: 3.78, required: 4.20 },
      { month: 'Oct', score: 3.82, required: 4.20 },
      { month: 'Nov', score: 3.79, required: 4.20 },
      { month: 'Dec', score: 3.82, required: 4.20 },
    ],
  },
  'vessel-002': {
    rating: 'D',
    score: 4.82,
    required: 4.20,
    status: 'critical',
    annualFuel: 9540,
    annualDistance: 48000,
    annualCo2: 30051,
    trajectory: [
      { month: 'Jan', score: 4.45, required: 4.20 },
      { month: 'Feb', score: 4.52, required: 4.20 },
      { month: 'Mar', score: 4.61, required: 4.20 },
      { month: 'Apr', score: 4.68, required: 4.20 },
      { month: 'May', score: 4.72, required: 4.20 },
      { month: 'Jun', score: 4.75, required: 4.20 },
      { month: 'Jul', score: 4.78, required: 4.20 },
      { month: 'Aug', score: 4.80, required: 4.20 },
      { month: 'Sep', score: 4.82, required: 4.20 },
      { month: 'Oct', score: 4.82, required: 4.20 },
      { month: 'Nov', score: 4.82, required: 4.20 },
      { month: 'Dec', score: 4.82, required: 4.20 },
    ],
  },
  'vessel-003': {
    rating: 'C',
    score: 4.15,
    required: 4.20,
    status: 'at_risk',
    annualFuel: 3720,
    annualDistance: 38000,
    annualCo2: 11718,
    trajectory: [
      { month: 'Jan', score: 3.98, required: 4.20 },
      { month: 'Feb', score: 4.02, required: 4.20 },
      { month: 'Mar', score: 4.05, required: 4.20 },
      { month: 'Apr', score: 4.08, required: 4.20 },
      { month: 'May', score: 4.10, required: 4.20 },
      { month: 'Jun', score: 4.11, required: 4.20 },
      { month: 'Jul', score: 4.12, required: 4.20 },
      { month: 'Aug', score: 4.13, required: 4.20 },
      { month: 'Sep', score: 4.14, required: 4.20 },
      { month: 'Oct', score: 4.15, required: 4.20 },
      { month: 'Nov', score: 4.15, required: 4.20 },
      { month: 'Dec', score: 4.15, required: 4.20 },
    ],
  },
};

// GET /api/compliance/cii/:vesselId
router.get('/cii/:vesselId', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const { vesselId } = req.params;

  const vessel = requireVessel(req, res, vesselId);
  if (!vessel) return;

  const ciiData = CII_DATA[vesselId];
  if (!ciiData) {
    res.status(404).json({ error: 'CII data not found for this vessel' });
    return;
  }

  const ratingBands = {
    A: { min: 0, max: ciiData.required * 0.86 },
    B: { min: ciiData.required * 0.86, max: ciiData.required * 0.94 },
    C: { min: ciiData.required * 0.94, max: ciiData.required * 1.06 },
    D: { min: ciiData.required * 1.06, max: ciiData.required * 1.18 },
    E: { min: ciiData.required * 1.18, max: 99 },
  };

  const recommendations = vesselId === 'vessel-002'
    ? [
        'CRITICAL: Immediately reduce average speed from 13.5 to 11.0 knots on all non-time-sensitive voyages',
        'Reschedule drydock for engine overhaul to improve SFOC by estimated 8%',
        'Implement slow steaming protocol: target 11 knots laden, 9 knots ballast',
        'Engage with charterer for speed optimization clause in next fixture',
        'Consider carbon offset program to supplement operational measures',
      ]
    : vesselId === 'vessel-003'
    ? [
        'CII at risk of exceeding required threshold — implement speed optimization',
        'Reduce average speed by 0.5 knots to improve CII score by ~0.15',
        'Optimize trim and hull condition to reduce fuel consumption',
        'Consider weather routing to avoid adverse conditions and save fuel',
      ]
    : [
        'Maintain current operational practices — CII rating B is good',
        'Continued weather routing optimization can push to rating A next year',
        'Monitor monthly to ensure trajectory stays on track',
        'Hull cleaning due in 90 days — plan to maintain current SFOC',
      ];

  res.json({
    vesselId,
    vessel: {
      id: vessel.id,
      name: vessel.name,
      type: vessel.type,
      dwt: vessel.dwt,
      builtYear: vessel.builtYear,
    },
    cii: {
      rating: ciiData.rating,
      score: ciiData.score,
      required: ciiData.required,
      status: ciiData.status,
      percentageAboveRequired: parseFloat(
        (((ciiData.score - ciiData.required) / ciiData.required) * 100).toFixed(2)
      ),
      ratingBands,
      trajectory: ciiData.trajectory,
      annualStats: {
        fuelConsumed: ciiData.annualFuel,
        distanceTraveled: ciiData.annualDistance,
        co2Emitted: ciiData.annualCo2,
        avgSpeed: vessel.currentSpeed,
      },
    },
    recommendations,
    regulatoryContext: {
      regulation: 'IMO MARPOL Annex VI',
      applicableFrom: '2023-01-01',
      requiredRating: 'C or better',
      penaltyRating: 'D or E triggers corrective action plan',
      currentYear: new Date().getFullYear(),
      improvementPerYear: '2% reduction in required CII from 2023 baseline',
    },
  });
});

// GET /api/compliance/ets/:vesselId
router.get('/ets/:vesselId', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const { vesselId } = req.params;

  const vessel = requireVessel(req, res, vesselId);
  if (!vessel) return;

  const ciiData = CII_DATA[vesselId];
  const euVoyagePercent = vesselId === 'vessel-001' ? 0.45 : vesselId === 'vessel-002' ? 0.38 : 0.12;
  const annualCo2 = ciiData?.annualCo2 || 10000;
  const euCo2 = Math.round(annualCo2 * euVoyagePercent);
  const etaPrice = 65; // EUR per tonne
  const freeAllowances2025 = Math.round(euCo2 * 0.3); // 30% free in 2025
  const payableTonnes = euCo2 - freeAllowances2025;
  const euaCost = Math.round(payableTonnes * etaPrice);

  res.json({
    vesselId,
    vessel: { id: vessel.id, name: vessel.name, type: vessel.type },
    ets: {
      year: 2025,
      totalCo2: annualCo2,
      euApplicableCo2: euCo2,
      euRoutePercent: Math.round(euVoyagePercent * 100),
      freeAllowances: freeAllowances2025,
      payableTonnes,
      euaPrice: etaPrice,
      estimatedCost: euaCost,
      allowancesCoverage: Math.round((freeAllowances2025 / euCo2) * 100),
      complianceStatus: 'compliant',
      monthlyBreakdown: Array.from({ length: 12 }, (_, i) => ({
        month: new Date(2025, i).toLocaleString('default', { month: 'short' }),
        co2: Math.round((euCo2 / 12) * (0.9 + Math.random() * 0.2)),
        cost: Math.round((euaCost / 12) * (0.9 + Math.random() * 0.2)),
      })),
    },
    regulatory: {
      regulation: 'EU Emissions Trading System (ETS)',
      applicableFrom: '2024-01-01',
      phaseIn: '2024: 40%, 2025: 70%, 2026: 100% of EU voyages',
      currentCoverageRate: 70,
    },
  });
});

// POST /api/compliance/generate-mrv-report
router.post('/generate-mrv-report', authenticate, validate(GenerateMrvReportSchema), (req: AuthenticatedRequest, res: Response) => {
  const { vesselId, year = 2024 } = req.body;

  const vessel = requireVessel(req, res, vesselId);
  if (!vessel) return;

  const ciiData = CII_DATA[vesselId];
  const voyages = MOCK_VOYAGES.filter(v => v.vesselId === vesselId && v.status === 'completed');
  const totalFuel = voyages.reduce((sum, v) => sum + (v.actualFuel || v.plannedFuel), 0);
  const totalDistance = voyages.reduce((sum, v) => sum + (v.actualDistance || v.plannedDistance), 0);
  const totalCo2 = voyages.reduce((sum, v) => sum + (v.co2Emissions || 0), 0);

  res.json({
    vesselId,
    year,
    vessel: {
      name: vessel.name,
      imoNumber: vessel.imoNumber,
      type: vessel.type,
      flag: vessel.flag,
      dwt: vessel.dwt,
    },
    mrvReport: {
      reportingPeriod: `${year}-01-01 to ${year}-12-31`,
      totalVoyages: voyages.length,
      totalDistanceNm: totalDistance,
      totalFuelMt: totalFuel,
      totalCo2Tonnes: totalCo2 || (ciiData?.annualCo2 || 0),
      fuelBreakdown: {
        VLSFO: Math.round(totalFuel * 0.85),
        MGO: Math.round(totalFuel * 0.15),
      },
      portVisits: voyages.length,
      euPortCalls: Math.round(voyages.length * 0.3),
      ciiRating: ciiData?.rating || 'C',
      ciiScore: ciiData?.score || 4.0,
      verificationStatus: 'draft',
      verifier: 'DNV GL Maritime',
      submissionDeadline: `${year + 1}-06-30`,
    },
    generatedAt: new Date().toISOString(),
  });
});

// POST /api/compliance/chat - STREAMING SSE
router.post('/chat', authenticate, aiLimiter, validate(ComplianceChatSchema), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { message, vesselId, conversationHistory = [] } = req.body;

  const vessel = resolveFleetVessel(req, vesselId);
  if (!vessel) {
    res.status(403).json({ error: 'No accessible vessel for your fleet' });
    return;
  }
  const ciiData = CII_DATA[vessel.id];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const systemPrompt = `You are VesselMind Compliance AI, an expert in maritime environmental regulations. You assist fleet managers with CII, MARPOL, EU ETS, and MRV compliance.

Current vessel context:
- Vessel: ${vessel.name} (${vessel.type}, ${vessel.dwt} DWT, built ${vessel.builtYear})
- CII Rating: ${ciiData?.rating || 'C'} (Score: ${ciiData?.score || 4.0}, Required: ${ciiData?.required || 4.20})
- Status: ${ciiData?.status || 'at_risk'}

You have expertise in:
- IMO CII (Carbon Intensity Indicator) regulations
- EU Emissions Trading System (ETS) for shipping
- MRV (Monitoring, Reporting, Verification) requirements
- MARPOL Annex VI compliance
- EEXI (Energy Efficiency Existing Ship Index)
- Speed optimization and fuel efficiency strategies

Provide specific, actionable advice. Reference regulation numbers when relevant (e.g., MARPOL Annex VI Regulation 28).${SYSTEM_GUARDRAILS}`;

  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    ...conversationHistory,
    { role: 'user', content: message },
  ];

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }
  } catch (error) {
    console.error('Compliance chat streaming error:', error);
    res.write(
      `data: ${JSON.stringify({
        text: 'I apologize, the AI service is temporarily unavailable. For CII compliance, I recommend reviewing your vessel speed profile and considering weather routing optimization to reduce fuel consumption and improve your carbon intensity rating.',
      })}\n\n`
    );
  }

  res.write('data: [DONE]\n\n');
  res.end();
});

export default router;
