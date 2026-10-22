import { Injectable, NotFoundException } from '@nestjs/common';
import type { OrganizationAccess } from '../auth/organization-access.service.js';
import type { ImportBatch } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ImportBatchDetailDto, ImportBatchListDto, ImportBatchSummaryDto, ImportIssueDto } from './imports.dto.js';

const DECIMALS = { NET_AMOUNT: 2, LINE_COUNT: 0, QUANTITY: 3 } as const;

/** Read side of import batches. Every query is scoped by the verified organization. */
@Injectable()
export class ImportBatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(access: OrganizationAccess, limit = 20, offset = 0): Promise<ImportBatchListDto> {
    const where = { organizationId: access.organizationId };
    const [items, total] = await Promise.all([
      this.prisma.importBatch.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.importBatch.count({ where }),
    ]);
    return { items: items.map(toSummary), total, limit, offset };
  }

  async get(access: OrganizationAccess, batchId: string): Promise<ImportBatchDetailDto> {
    // Filtering by BOTH id and organization: a batch id from another organization is
    // simply "not found" here, never returned.
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, organizationId: access.organizationId },
      include: { reconciliationResults: { orderBy: [{ month: 'asc' }, { metric: 'asc' }] } },
    });
    if (!batch) throw new NotFoundException('Import batch not found');
    return {
      ...toSummary(batch),
      issues: batch.issues as unknown as ImportIssueDto[],
      reconciliation: batch.reconciliationResults.map((r) => ({
        metric: r.metric,
        month: r.month,
        currency: r.currency,
        unit: r.unit,
        expected: r.expectedValue.toFixed(DECIMALS[r.metric]),
        actual: r.actualValue.toFixed(DECIMALS[r.metric]),
        passed: r.passed,
      })),
    };
  }
}

export function toSummary(b: ImportBatch): ImportBatchSummaryDto {
  return {
    id: b.id,
    fileName: b.fileName,
    fileSha256: b.fileSha256,
    fileSizeBytes: b.fileSizeBytes,
    isSynthetic: b.isSynthetic,
    status: b.status,
    reconciliationStatus: b.reconciliationStatus,
    stats: {
      rowsTotal: b.rowsTotal,
      rowsValid: b.rowsValid,
      rowsInvalid: b.rowsInvalid,
      rowsDuplicateInFile: b.rowsDuplicateInFile,
      rowsAlreadyImported: b.rowsAlreadyImported,
      rowsInserted: b.rowsInserted,
    },
    createdAt: b.createdAt.toISOString(),
    createdByUserId: b.createdByUserId,
    publishedAt: b.publishedAt?.toISOString() ?? null,
    publishedByUserId: b.publishedByUserId,
  };
}
