import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { MOCK_FLEET, MOCK_VESSELS, MockVessel } from '../mock/vessels';
import { MOCK_EQUIPMENT } from '../mock/equipment';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { fleetVessels, requireVessel } from '../lib/tenant';
import { validate } from '../middleware/validate';
import { VesselCreateSchema, VesselUpdateSchema } from '../schemas';

const router = Router();

// Free-text search over the fields a fleet operator would actually scan for:
// vessel name, IMO number, type and flag. Case-insensitive, whitespace-trimmed.
// Applied identically to the DB and mock code paths so search behaves the same
// whether or not Postgres is seeded.
function matchesSearch(v: { name: string; imoNumber: string; type: string; flag: string }, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    v.name.toLowerCase().includes(needle) ||
    v.imoNumber.toLowerCase().includes(needle) ||
    v.type.toLowerCase().includes(needle) ||
    v.flag.toLowerCase().includes(needle)
  );
}

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
  // Optional free-text filter. The Angular table drives this from an RxJS
  // debounced search box, so the query lands here rather than being filtered
  // naively on the client after fetching every row.
  const search = typeof req.query.search === 'string' ? req.query.search : '';

  if (fleetId) {
    try {
      const vessels = await dbVesselsForFleet(fleetId);
      if (vessels.length > 0) {
        res.json(vessels.filter((v) => matchesSearch(v, search)));
        return;
      }
    } catch {
      // DB unavailable — fall through to mock fixtures below
    }
  }

  res.json(fleetVessels(req).filter((v) => matchesSearch(v, search)));
});

// POST /api/vessels — create a vessel in the caller's own fleet.
// Persists to Postgres when reachable; otherwise appends to the in-memory
// fixture set so the demo works end-to-end without a database (the same
// graceful-degradation pattern used by the read paths and auth). The in-memory
// record is not durable across a server restart — that's expected for the demo.
router.post('/vessels', authenticate, validate(VesselCreateSchema), async (req: AuthenticatedRequest, res: Response) => {
  const fleetId = req.user?.fleetId;
  if (!fleetId) {
    res.status(403).json({ error: 'You are not assigned to a fleet' });
    return;
  }

  const body = req.body as {
    name: string; imoNumber: string; type: string; flag: string; builtYear: number;
    dwt: number; engineType: string; enginePower: number; maxSpeed: number;
    designSpeed: number; fuelCapacity: number; status: string;
  };

  try {
    const created = await prisma.vessel.create({
      data: { ...body, fleetId, currentLat: 0, currentLon: 0, currentSpeed: 0 },
    });
    res.status(201).json(created);
    return;
  } catch {
    // DB unavailable/unseeded — fall back to the in-memory fixtures.
  }

  const mockVessel: MockVessel = {
    id: `vessel-${randomUUID().slice(0, 8)}`,
    ...body,
    fleetId,
    currentLat: 0,
    currentLon: 0,
    currentSpeed: 0,
    // Fuel-model params aren't collected by the dashboard form; use neutral
    // defaults so the record is still well-formed for the AI modules.
    lightshipTonnage: Math.round(body.dwt * 0.15),
    sfocRefGPerKwh: 170,
    lastDrydockDate: new Date().toISOString().slice(0, 10),
  };
  MOCK_VESSELS.push(mockVessel);
  res.status(201).json(mockVessel);
});

// PATCH /api/vessels/:id — partial update, tenant-scoped. requireVessel() writes
// the 404/403 response itself and returns null when the caller may not touch it.
router.patch('/vessels/:id', authenticate, validate(VesselUpdateSchema), async (req: AuthenticatedRequest, res: Response) => {
  const fleetId = req.user?.fleetId;
  const patch = req.body as Partial<MockVessel>;

  if (fleetId) {
    try {
      const dbVessel = await prisma.vessel.findUnique({ where: { id: req.params.id } });
      if (dbVessel) {
        if (dbVessel.fleetId !== fleetId) {
          res.status(403).json({ error: 'Access to this vessel is not permitted' });
          return;
        }
        const updated = await prisma.vessel.update({ where: { id: req.params.id }, data: patch });
        res.json(updated);
        return;
      }
    } catch {
      // DB unavailable — fall through to mock fixtures below
    }
  }

  const vessel = requireVessel(req, res, req.params.id);
  if (!vessel) return;
  Object.assign(vessel, patch);
  res.json(vessel);
});

export default router;
