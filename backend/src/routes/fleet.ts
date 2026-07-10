import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { MOCK_FLEET } from '../mock/vessels';
import { MOCK_EQUIPMENT } from '../mock/equipment';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { fleetVessels, requireVessel } from '../lib/tenant';

const router = Router();
const prisma = new PrismaClient();

// Vessel/fleet listing is backed by Postgres via Prisma when the database is
// reachable and seeded. If it isn't (e.g. running the demo without `docker
// compose up` + `db:seed`), we fall back to the same in-memory fixtures the
// rest of the app's AI modules use, so the app degrades gracefully instead
// of 500ing — mirroring the resilience pattern already used in auth.ts.

async function dbVesselsForFleet(fleetId: string) {
  return prisma.vessel.findMany({ where: { fleetId }, orderBy: { name: 'asc' } });
}

router.get('/fleet', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const fleetId = req.user?.fleetId;
  if (fleetId) {
    try {
      const [fleet, vessels] = await Promise.all([
        prisma.fleet.findUnique({ where: { id: fleetId } }),
        dbVesselsForFleet(fleetId),
      ]);
      if (fleet) {
        res.json({ ...fleet, vessels });
        return;
      }
    } catch {
      // DB unavailable or not seeded — fall through to mock fixtures below
    }
  }

  res.json({
    ...MOCK_FLEET,
    vessels: fleetVessels(req),
  });
});

router.get('/vessels/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const fleetId = req.user?.fleetId;
  if (fleetId) {
    try {
      const dbVessel = await prisma.vessel.findUnique({ where: { id: req.params.id } });
      if (dbVessel) {
        if (dbVessel.fleetId !== fleetId) {
          res.status(403).json({ error: 'Access to this vessel is not permitted' });
          return;
        }
        const equipment = await prisma.equipment.findMany({ where: { vesselId: req.params.id } });
        res.json({ ...dbVessel, equipment });
        return;
      }
    } catch {
      // DB unavailable — fall through to mock fixtures below
    }
  }

  const vessel = requireVessel(req, res, req.params.id);
  if (!vessel) return;

  const equipment = MOCK_EQUIPMENT.filter(e => e.vesselId === req.params.id);
  res.json({ ...vessel, equipment });
});

router.get('/vessels', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const fleetId = req.user?.fleetId;
  if (fleetId) {
    try {
      const vessels = await dbVesselsForFleet(fleetId);
      if (vessels.length > 0) {
        res.json(vessels);
        return;
      }
    } catch {
      // DB unavailable — fall through to mock fixtures below
    }
  }

  res.json(fleetVessels(req));
});

export default router;
