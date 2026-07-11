import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { getLatestPositions, getPositionsNear } from '../services/aisStream';

const router = Router();

// GET /api/ais/positions — latest live position per vessel (most recent first).
router.get('/positions', authenticate, async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json({ positions: await getLatestPositions() });
  } catch {
    res.status(503).json({ error: 'AIS data unavailable' });
  }
});

// GET /api/ais/positions/near?lat=&lon= — vessels near a coordinate.
router.get('/positions/near', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
