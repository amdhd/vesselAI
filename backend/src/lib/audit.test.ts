import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: { auditLog: { create: vi.fn() } },
}));
vi.mock('./logger', () => ({ logger: { error: vi.fn() } }));

import { recordAudit } from './audit';
import { prisma } from './prisma';
import { logger } from './logger';

const create = vi.mocked(prisma.auditLog.create);
const logError = vi.mocked(logger.error);

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({} as never);
});

describe('recordAudit', () => {
  it('writes the entry to the audit log', async () => {
    await recordAudit({
      userId: 'user-1',
      entity: 'Vessel',
      action: 'create',
      entityId: 'vessel-99',
      details: { name: 'MT Audit Test' },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        action: 'create',
        entity: 'Vessel',
        entityId: 'vessel-99',
        details: { name: 'MT Audit Test' },
      },
    });
  });

  it('records a null actor and entity id when the event has neither', async () => {
    await recordAudit({ entity: 'Vessel', action: 'update' });

    const { data } = create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.userId).toBeNull();
    expect(data.entityId).toBeNull();
    // Absent details must stay unset rather than becoming JSON null, so a row
    // without a snapshot is distinguishable from one whose snapshot was null.
    expect(data.details).toBeUndefined();
  });

  it('drops undefined values inside details so a Json column accepts them', async () => {
    // A PATCH body can carry explicit undefineds; Prisma's Json input rejects them.
    await recordAudit({ entity: 'Vessel', action: 'update', details: { name: 'MT Renamed', status: undefined } });

    const { data } = create.mock.calls[0][0] as { data: { details: Record<string, unknown> } };
    expect(data.details).toEqual({ name: 'MT Renamed' });
    expect('status' in data.details).toBe(false);
  });

  it('swallows a failed write and reports it, rather than failing the operation', async () => {
    create.mockRejectedValue(new Error('relation "audit_logs" does not exist'));

    await expect(recordAudit({ entity: 'Vessel', action: 'create', entityId: 'vessel-99' })).resolves.toBeUndefined();

    // The failure is still visible: a trail with a hole in it has to say so.
    expect(logError).toHaveBeenCalled();
    expect(String(logError.mock.calls[0][1])).toMatch(/audit log write failed/i);
  });
});
