import { Router, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { syncWeather, getLatestObservations, getObservationsNear } from '../services/weatherPipeline';

const router = Router();

// POST /api/weather/sync — manually trigger an ingestion run. Restricted to
// fleet_manager: it makes outbound calls and writes to the DB (cost/abuse).
router.post('/sync', authenticate, requireRole(['fleet_manager']), async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const summary = await syncWeather();
    // 502 if every point failed (upstream/DB down) so callers can distinguish a
    // total failure from a partial run.
    res.status(summary.ingested === 0 && summary.failed > 0 ? 502 : 200).json(summary);
  } catch (err) {
    console.error('[weather] sync failed:', err);
    res.status(502).json({ error: 'Weather sync failed' });
  }
});

// GET /api/weather/latest — most recent observations across all locations.
router.get('/latest', authenticate, async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json({ observations: await getLatestObservations() });
  } catch {
    res.status(503).json({ error: 'Weather data unavailable' });
  }
});

// GET /api/weather/near?lat=&lon= — observations near a coordinate.
router.get('/near', authenticate, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    res.status(400).json({ error: 'lat and lon query params are required numbers' });
    return;
  }
  try {
    res.json({ observations: await getObservationsNear(lat, lon) });
  } catch {
    res.status(503).json({ error: 'Weather data unavailable' });
  }
});

export default router;
