import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const db = vi.hoisted(() => ({
  owner: 'fleet-b',
  $queryRaw: vi.fn(),
  workOrder: { create: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/audit', () => ({ recordAudit: vi.fn() }));
vi.mock('../services/aiService', () => ({ generateJson: vi.fn() }));
import maintenance from './maintenance';
import { JWT_SECRET } from '../lib/jwtConfig';

const app = express();
app.use(express.json());
app.use('/api/maintenance', maintenance);
const order = {
  id: 'order-b', vesselId: 'vessel-001', equipmentId: 'unknown', equipmentName: 'Pump',
  title: 'B private order', description: 'B private details', priority: 'high', status: 'open',
  type: 'corrective', assignedTo: null, requiredParts: null, estimatedHours: null,
  plannedDate: null, completedDate: null, createdAt: new Date('2026-10-01'),
};
function token(fleetId: string | null) {
  return jwt.sign({ id: 'dummy-user', fleetId, role: 'fleet_manager' }, JWT_SECRET, { expiresIn: '1h' });
}
const list = (fleetId: string | null) => request(app).get('/api/maintenance/work-orders/vessel-001')
  .set('Authorization', `Bearer ${token(fleetId)}`);
const create = (fleetId: string | null) => request(app).post('/api/maintenance/work-order')
  .set('Authorization', `Bearer ${token(fleetId)}`).send({
    vesselId: 'vessel-001', equipmentId: 'unknown', equipmentName: 'Pump',
    title: 'New order', description: 'Dummy details', priority: 'high',
  });

beforeEach(() => {
  vi.resetAllMocks();
  db.owner = 'fleet-b';
  db.$transaction.mockImplementation(async (run) => run(db));
  db.$queryRaw.mockImplementation(async (_sql, _id, fleetId) => db.owner === fleetId ? [{ id: 'vessel-001' }] : []);
  db.workOrder.findMany.mockResolvedValue([order]);
  db.workOrder.create.mockResolvedValue(order);
});

describe('persisted work-order ownership', () => {
  it('denies the catalogue owner when the database vessel belongs to another fleet', async () => {
    expect((await list('fleet-001')).status).toBe(403);
    expect((await create('fleet-001')).status).toBe(403);
    expect(db.workOrder.findMany).not.toHaveBeenCalled();
    expect(db.workOrder.create).not.toHaveBeenCalled();
  });

  it('allows the current database owner even when the catalogue disagrees', async () => {
    const res = await list('fleet-b');
    expect(res.status).toBe(200);
    expect(res.body.workOrders[0].id).toBe('order-b');
    expect((await create('fleet-b')).status).toBe(201);
    const [sql, id, fleet] = db.$queryRaw.mock.calls[0];
    expect(sql.join('?')).toMatch(/FOR SHARE/);
    expect(id).toBe('vessel-001');
    expect(fleet).toBe('fleet-b');
  });

  it('fails closed if ownership cannot be read or the vessel is missing', async () => {
    db.$queryRaw.mockRejectedValue(new Error('Database unavailable'));
    expect((await list('fleet-001')).status).toBe(503);
    expect((await create('fleet-001')).status).toBe(503);
    db.$queryRaw.mockResolvedValue([]);
    expect((await list('fleet-001')).status).toBe(403);
    expect(db.workOrder.findMany).not.toHaveBeenCalled();
    expect(db.workOrder.create).not.toHaveBeenCalled();
  });

  it('denies fleetless accounts without entering a database transaction', async () => {
    expect((await list(null)).status).toBe(403);
    expect((await create(null)).status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
