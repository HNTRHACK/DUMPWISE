import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditInput {
  /** null for user-level security events (login, logout, password change). */
  organizationId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

type Db = Pick<PrismaService, 'auditEvent'> | Prisma.TransactionClient;

// Append-only audit trail. Pass the transaction client to record the event atomically
// with the change it describes.
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput, db: Db = this.prisma): Promise<void> {
    await db.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata ?? {},
      },
    });
  }
}
