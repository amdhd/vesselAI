import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// The suite runs with no DATABASE_URL (see integration.test.ts), so reaching a
// successful mutation — and therefore the audit call that follows it — needs a
// Prisma double. Everything else is the real app: real auth middleware, real
// validation, real handlers.
vi.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    vessel: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    workOrder: { create: vi.fn() },
    bunkerRecord: { createMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import { createApp } from '../app';
import { JWT_SECRET } from '../lib/jwtConfig';
import { prisma } from '../lib/prisma';

const app = createApp();
const auditLog = vi.mocked(prisma.auditLog.create);

const VESSEL_BODY = {
  name: 'MT Audit Test',
  imoNumber: '9123456',
  type: 'tanker',
  flag: 'MY',
  builtYear: 2015,
  dwt: 50000,
  maxSpeed: 15,
  designSpeed: 13,
};

function managerToken(): string {
  return jwt.sign(
    {
      id: 'user-1',
      email: 'manager@petronas.com',
      role: 'fleet_manager',
      fleetId: 'fleet-001',
      name: 'Fleet Manager',
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

/** The `data` of every audit row written during a test. */
function auditRows() {
  return auditLog.mock.calls.map(([arg]) => (arg as { data: unknown }).data);
}

beforeEach(() => {
  vi.clearAllMocks();
  auditLog.mockResolvedValue({} as never);
});

describe('audit trail', () => {
  it('records who created a vessel', async () => {
    vi.mocked(prisma.vessel.create).mockResolvedValue({
      id: 'vessel-99',
      name: VESSEL_BODY.name,
      imoNumber: VESSEL_BODY.imoNumber,
      fleetId: 'fleet-001',
    } as never);

    const res = await request(app)
      .post('/api/vessels')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send(VESSEL_BODY);

    expect(res.status).toBe(201);
    expect(auditRows()).toEqual([
      {
        userId: 'user-1',
        action: 'create',
        entity: 'Vessel',
        entityId: 'vessel-99',
        details: { name: 'MT Audit Test', imoNumber: '9123456', fleetId: 'fleet-001' },
      },
    ]);
  });

  it('records what a vessel update changed', async () => {
    vi.mocked(prisma.vessel.findUnique).mockResolvedValue({ id: 'vessel-99', fleetId: 'fleet-001' } as never);
    vi.mocked(prisma.vessel.update).mockResolvedValue({ id: 'vessel-99', name: 'MT Renamed' } as never);

    const res = await request(app)
      .patch('/api/vessels/vessel-99')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({ name: 'MT Renamed' });

    expect(res.status).toBe(200);
    expect(auditRows()).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        action: 'update',
        entity: 'Vessel',
        entityId: 'vessel-99',
        details: { name: 'MT Renamed' },
      }),
    ]);
  });

  it('records a work order', async () => {
    vi.mocked(prisma.workOrder.create).mockResolvedValue({
      id: 'wo-1',
      vesselId: 'vessel-001',
      equipmentId: 'eq-unknown',
      equipmentName: 'Cargo Pump #1',
      type: 'corrective',
      title: 'Replace bearing',
      description: 'Vibration rising over three watches',
      priority: 'high',
      status: 'open',
      assignedTo: null,
      requiredParts: null,
      estimatedHours: null,
      plannedDate: null,
      completedDate: null,
      createdAt: new Date('2026-10-08T00:00:00Z'),
    } as never);

    const res = await request(app)
      .post('/api/maintenance/work-order')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send({
        equipmentId: 'eq-unknown',
        equipmentName: 'Cargo Pump #1',
        vesselId: 'vessel-001',
        title: 'Replace bearing',
        description: 'Vibration rising over three watches',
        priority: 'high',
      });

    expect(res.status).toBe(201);
    expect(auditRows()).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        action: 'create',
        entity: 'WorkOrder',
        entityId: 'wo-1',
      }),
    ]);
  });

  it('records a registration under the new account', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'user-9',
      email: 'new@petronas.com',
      password: 'hashed',
      name: 'New Engineer',
      role: 'fleet_manager',
      fleetId: null,
    } as never);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@petronas.com', password: 'supersecret', name: 'New Engineer' });

    expect(res.status).toBe(201);
    // Registration has no signed-in actor, so the new account is its own subject.
    // The row identifies it by id; no email is copied into the trail.
    expect(auditRows()).toEqual([
      { userId: 'user-9', action: 'create', entity: 'User', entityId: 'user-9', details: { role: 'fleet_manager' } },
    ]);
  });

  it('records an import that changed something, and stays quiet when it did not', async () => {
    const csv = [
      'imoNumber,date,port,supplier,fuelGrade,quantityMt,pricePerMt,sulfurContent',
      '9876543,2026-06-01,Port of Singapore,Petronas Trading,VLSFO,1250.5,585.00,0.42',
    ].join('\n');

    const upload = () =>
      request(app)
        .post('/api/imports/bunker')
        .set('Authorization', `Bearer ${managerToken()}`)
        .attach('file', Buffer.from(csv), { filename: 'bunkers.csv', contentType: 'text/csv' });

    vi.mocked(prisma.vessel.findMany).mockResolvedValue([{ id: 'vessel-7', imoNumber: '9876543' }] as never);
    vi.mocked(prisma.bunkerRecord.createMany).mockResolvedValue({ count: 1 } as never);

    const imported = await upload();

    expect(imported.status).toBe(201);
    expect(auditRows()).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        action: 'import',
        entity: 'BunkerRecord',
        details: { imported: 1, skipped: 0, totalRows: 1 },
      }),
    ]);

    // Every row skipped means nothing was written, so there is no change to record.
    vi.clearAllMocks();
    auditLog.mockResolvedValue({} as never);
    vi.mocked(prisma.vessel.findMany).mockResolvedValue([] as never);

    const nothing = await upload();

    expect(nothing.status).toBe(200);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('returns success even when the audit write fails', async () => {
    vi.mocked(prisma.vessel.create).mockResolvedValue({
      id: 'vessel-99',
      name: VESSEL_BODY.name,
      imoNumber: VESSEL_BODY.imoNumber,
      fleetId: 'fleet-001',
    } as never);
    auditLog.mockRejectedValue(new Error('relation "audit_logs" does not exist'));

    const res = await request(app)
      .post('/api/vessels')
      .set('Authorization', `Bearer ${managerToken()}`)
      .send(VESSEL_BODY);

    // Losing the trail is bad; losing the vessel is worse. Had the audit failure
    // escaped, the handler's catch would have answered with an in-memory fixture
    // instead of the row it did persist — a phantom vessel at a fresh id.
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('vessel-99');
  });
});
