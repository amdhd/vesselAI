import { prisma } from './prisma';
import { logger } from './logger';

export interface AuditEntry {
  /** Who did it. Null when the event has no signed-in actor. */
  userId?: string | null;
  /** The thing touched, named as the model is: 'Vessel', 'WorkOrder'. */
  entity: string;
  /** What happened to it: 'create', 'update', 'import'. */
  action: string;
  entityId?: string | null;
  /**
   * A JSON snapshot of the change. Must not carry secrets — a password hash or a
   * token here would outlive the request in a table nothing prunes.
   */
  details?: unknown;
}

/**
 * Appends a row to the audit trail for a change a person asked for.
 *
 * Never throws. That is a contract, not a nicety: callers record the audit inside
 * the same try that guards the write it describes (fleet.ts treats any throw
 * there as "database unavailable" and falls back to the in-memory fixtures), so a
 * rejected audit row must not be able to turn a successful vessel creation into a
 * phantom fixture. A missing trail is logged loudly instead.
 *
 * Machine-driven writes — AIS positions, weather observations — are not audited:
 * they have no actor and would bury the human actions the table exists to show.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        // Round-trip through JSON so the value is plain JSON: a Json column
        // rejects `undefined` nested inside an object, and an update patch can
        // carry it. Absent details stay absent rather than becoming null.
        details: entry.details === undefined ? undefined : JSON.parse(JSON.stringify(entry.details)),
      },
    });
  } catch (error) {
    logger.error(
      { err: error, entity: entry.entity, action: entry.action, entityId: entry.entityId },
      'audit log write failed'
    );
  }
}
