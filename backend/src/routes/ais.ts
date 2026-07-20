import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requireFleetMembership } from '../lib/tenant';
import { getLatestPositions, getPositionsNear } from '../services/aisStream';

const router = Router();

// GET /api/ais/positions — latest live position per vessel (most recent first).
// AIS is public broadcast data scoped to the fleet's operating area, so it isn't
// per-fleet-owned — but it's still an operational surface, so gate it on fleet
// membership (a no-fleet user sees nothing else in the app either).
router.get('/positions', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requireFleetMembership(req, res)) return;
  try {
    res.json({ positions: await getLatestPositions() });
  } catch {
    res.status(503).json({ error: 'AIS data unavailable' });
  }
});

// GET /api/ais/positions/near?lat=&lon= — vessels near a coordinate.
router.get('/positions/near', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!requireFleetMembership(req, res)) return;
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    res.status(400).json({ error: 'lat and lon query params are required numbers' });
    return;
  }
  try {
    res.json({ positions: await getPositionsNear(lat, lon) });
  } catch {
    res.status(503).json({ error: 'AIS data unavailable' });
  }
});

export default router;
