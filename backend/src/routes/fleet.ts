import { Router, Request, Response } from 'express';
import { MOCK_FLEET } from '../mock/vessels';
import { MOCK_EQUIPMENT } from '../mock/equipment';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { fleetVessels, requireVessel } from '../lib/tenant';

const router = Router();

router.get('/fleet', authenticate, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    ...MOCK_FLEET,
    vessels: fleetVessels(req),
  });
});

router.get('/vessels/:id', authenticate, (req: AuthenticatedRequest, res: Response) => {
  const vessel = requireVessel(req, res, req.params.id);
  if (!vessel) return;

  const equipment = MOCK_EQUIPMENT.filter(e => e.vesselId === req.params.id);
  res.json({ ...vessel, equipment });
});

router.get('/vessels', authenticate, (req: AuthenticatedRequest, res: Response) => {
  res.json(fleetVessels(req));
});

export default router;
