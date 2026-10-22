import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export class PublicationBlockedException extends ConflictException {}

/**
 * Publication makes a batch's transactions visible to analytics APIs.
 * Rule: only an OWNER may publish, and only a batch whose reconciliation PASSED.
 */
@Injectable()
export class PublicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  async publish(organizationId: string, batchId: string, actorUserId: string) {
    await this.access.require(actorUserId, organizationId, ['OWNER']);
    const batch = await this.prisma.importBatch.findFirst({ where: { id: batchId, organizationId } });
    if (!batch) throw new NotFoundException('Import batch not found');
    if (batch.status === 'PUBLISHED') return batch;

    if (batch.status !== 'READY_TO_PUBLISH' || batch.reconciliationStatus !== 'PASSED') {
      await this.audit.record({
        organizationId, actorUserId, action: 'PUBLISH_BLOCKED', entityType: 'ImportBatch', entityId: batch.id,
        metadata: { status: batch.status, reconciliationStatus: batch.reconciliationStatus },
      });
      throw new PublicationBlockedException(
        `Publication blocked: batch status is ${batch.status}, reconciliation is ${batch.reconciliationStatus}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Conditional update: succeeds only if nobody changed the batch in the meantime.
      const res = await tx.importBatch.updateMany({
        where: { id: batch.id, organizationId, status: 'READY_TO_PUBLISH', reconciliationStatus: 'PASSED' },
        data: { status: 'PUBLISHED', publishedAt: new Date(), publishedByUserId: actorUserId },
      });
      if (res.count !== 1) throw new PublicationBlockedException('Batch changed concurrently; retry');
      await this.audit.record(
        { organizationId, actorUserId, action: 'BATCH_PUBLISHED', entityType: 'ImportBatch', entityId: batch.id },
        tx,
      );
      return tx.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    });
  }
}
