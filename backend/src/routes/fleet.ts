import { Router, Request, Response } from 'express';
import { MOCK_VESSELS, MOCK_FLEET } from '../mock/vessels';
import { MOCK_EQUIPMENT } from '../mock/equipment';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/fleet', authenticate, (_req: Request, res: Response) => {
  res.json({
    ...MOCK_FLEET,
    vessels: MOCK_VESSELS,
  });
});

router.get('/vessels/:id', authenticate, (req: Request, res: Response) => {
  const vessel = MOCK_VESSELS.find(v => v.id === req.params.id);
  if (!vessel) return res.status(404).json({ error: 'Vessel not found' });

  const equipment = MOCK_EQUIPMENT.filter(e => e.vesselId === req.params.id);
  res.json({ ...vessel, equipment });
});

router.get('/vessels', authenticate, (_req: Request, res: Response) => {
  res.json(MOCK_VESSELS);
});

export default router;
