import { Router, Request, Response } from 'express';
import { MOCK_PORTS } from '../mock/ports';
import { MOCK_ACTIVE_VOYAGES } from '../mock/voyages';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requireVessel } from '../lib/tenant';

const router = Router();

// GET /api/ports/congestion
router.get('/congestion', authenticate, (_req: Request, res: Response) => {
  res.json(MOCK_PORTS);
});

// GET /api/ports/demurrage/:vesselId
router.get('/demurrage/:vesselId', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const { vesselId } = req.params;

  const vessel = requireVessel(req, res, vesselId);
  if (!vessel) return;

  const activeVoyage = MOCK_ACTIVE_VOYAGES.find(v => v.vesselId === vesselId);

  // Demurrage rate by vessel type
  const demurrageRates: { [key: string]: number } = {
    VLCC: 35000,
    'Aframax Tanker': 18000,
    'Offshore Supply Vessel': 12500,
  };

  const demurrageRatePerDay = demurrageRates[vessel.type] || 15000;

  // Port data for the active voyage destination
  let destinationPort = null;
  if (activeVoyage) {
    destinationPort = MOCK_PORTS.find(p =>
      p.name.toLowerCase().includes(activeVoyage.destinationPort.toLowerCase()) ||
      activeVoyage.destinationPort.toLowerCase().includes(p.name.toLowerCase())
    );
  }

  if (!destinationPort) {
    destinationPort = MOCK_PORTS[0]; // Default to Fujairah
  }

  const portCongestion = destinationPort.congestion;
  const congestionHours = destinationPort.avgWaitHours;

  // Calculate laytime - assumed 72 hours for tankers
  const laytimeHours = vessel.type === 'VLCC' ? 72 : vessel.type === 'Aframax Tanker' ? 48 : 24;
  const usedLaytimeHours = Math.round(laytimeHours * 0.7); // 70% used
  const remainingLaytimeHours = laytimeHours - usedLaytimeHours;

  const isAtRisk = congestionHours > remainingLaytimeHours;
  const estimatedDemurrageHours = isAtRisk ? Math.max(0, congestionHours - remainingLaytimeHours) : 0;
  const estimatedDemurrageCost = Math.round((estimatedDemurrageHours / 24) * demurrageRatePerDay);

  res.json({
    vesselId,
    vessel: { id: vessel.id, name: vessel.name, type: vessel.type },
    activeVoyage: activeVoyage
      ? {
          id: activeVoyage.id,
          departurePort: activeVoyage.departurePort,
          destinationPort: activeVoyage.destinationPort,
          departureDate: activeVoyage.departureDate,
        }
      : null,
    destinationPort: {
      id: destinationPort.id,
      name: destinationPort.name,
      code: destinationPort.code,
      congestion: portCongestion,
      avgWaitHours: congestionHours,
      nextBerthAvailable: destinationPort.nextBerthAvailable,
      agentContacts: destinationPort.agentContacts,
    },
    demurrage: {
      rate: demurrageRatePerDay,
      currency: 'USD',
      laytimeAllowed: laytimeHours,
      laytimeUsed: usedLaytimeHours,
      laytimeRemaining: remainingLaytimeHours,
      expectedPortWait: congestionHours,
      isAtRisk,
      estimatedDemurrageHours,
      estimatedDemurrageCost,
      recommendation: isAtRisk
        ? `WARNING: Port congestion of ${congestionHours}h exceeds remaining laytime of ${remainingLaytimeHours}h. Estimated demurrage: $${estimatedDemurrageCost.toLocaleString()}. Contact port agent to negotiate berth priority.`
        : `Port congestion (${congestionHours}h) is within remaining laytime (${remainingLaytimeHours}h). No demurrage expected at current trajectory.`,
    },
    forecast: destinationPort.forecast.slice(0, 5),
  });
});

// GET /api/ports/:id
router.get('/:id', authenticate, (req: Request, res: Response) => {
  const port = MOCK_PORTS.find(p => p.id === req.params.id || p.code === req.params.id);
  if (!port) {
    res.status(404).json({ error: 'Port not found' });
    return;
  }
  res.json(port);
});

export default router;
