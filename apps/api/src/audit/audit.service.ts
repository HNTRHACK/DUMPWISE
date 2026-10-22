import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { TenantDb, type TenantTx } from '../prisma/tenant-db.service.js';

export interface AuditInput {
  /** null for user-level security events (login, logout, password change). */
  organizationId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

// Append-only audit trail. Pass the tenant transaction to record the event atomically with
// the change it describes; otherwise the event is written in its own tenant transaction.
@Injectable()
export class AuditService {
  constructor(private readonly tenantDb: TenantDb) {}

  async record(input: AuditInput, tx?: TenantTx): Promise<void> {
    const write = (db: TenantTx) =>
      // createMany (no RETURNING): under row-level security, RETURNING would also require the
      // new row to pass the SELECT policy, which an anonymous failed-login event cannot.
      db.auditEvent.createMany({
        data: [
          {
            organizationId: input.organizationId,
            actorUserId: input.actorUserId,
            action: input.action,
            entityType: input.entityType,
            entityId: input.entityId ?? null,
            metadata: input.metadata ?? {},
          },
        ],
      });
    if (tx) await write(tx);
    else await this.tenantDb.run({ organizationId: input.organizationId, userId: input.actorUserId }, write);
  }
}
