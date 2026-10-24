import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { periods } from '../analytics/analytics.service.js';
import { OrganizationAccessService, type OrganizationAccess } from '../auth/organization-access.service.js';
import { TenantDb } from '../prisma/tenant-db.service.js';
import type { TransactionsQueryDto, TransactionsResponseDto } from './transactions.dto.js';

@Injectable()
export class TransactionsService {
  constructor(private readonly db: TenantDb, private readonly access: OrganizationAccessService) {}

  async get(ctx: OrganizationAccess, id: string, q: TransactionsQueryDto) {
    const result = await this.list(ctx, { ...q, transactionId: id, limit: 1, offset: 0 });
    if (!result.items.length) throw new NotFoundException('Published transaction not found in this report scope');
    return result.items[0];
  }

  async list(ctx: OrganizationAccess, q: TransactionsQueryDto): Promise<TransactionsResponseDto> {
    await this.access.require(ctx.userId, ctx.organizationId, ['OWNER', 'ANALYST']);
    const p = periods(q);
    if (q.search && !q.dimension) throw new BadRequestException('A search requires its analytics dimension');
    if (!['asc', 'desc'].includes(q.direction)) throw new BadRequestException('Invalid direction');
    const code = Prisma.raw(q.dimension === 'distributors' ? 'd.code' : q.dimension === 'customers' ? 'c.code' : 'p.sku');
    const name = Prisma.raw(q.dimension === 'distributors' ? 'd.name' : q.dimension === 'customers' ? 'c.name' : 'p.description');
    // One SQL statement gives the page and full-subset totals the same MVCC snapshot.
    const result = await this.db.run(ctx, tx => tx.$queryRaw<Pick<TransactionsResponseDto, 'items' | 'total' | 'summary'>[]>(Prisma.sql`
      WITH subset AS (
        SELECT t.*, p.sku, d.code AS distributor_code, c.code AS customer_code,
          b.file_name, b.file_sha256, b.template_version_id, b.rules_version
        FROM sales_transactions t
        JOIN import_batches b ON b.organization_id=t.organization_id AND b.id=t.import_batch_id
        JOIN products p ON p.organization_id=t.organization_id AND p.id=t.product_id
        JOIN distributors d ON d.organization_id=t.organization_id AND d.id=t.distributor_id
        JOIN customers c ON c.organization_id=t.organization_id AND c.id=t.customer_id
        WHERE t.organization_id=${ctx.organizationId}::uuid
          AND b.status='PUBLISHED' AND b.reconciliation_status='PASSED'
          AND t.billing_date>=${p.start}::date AND t.billing_date<${p.end}::date AND t.currency=${q.currency}
          AND (${q.unit ?? null}::text IS NULL OR t.sales_unit=${q.unit ?? null})
          AND (${q.productId ?? null}::uuid IS NULL OR t.product_id=${q.productId ?? null}::uuid)
          AND (${q.distributorId ?? null}::uuid IS NULL OR t.distributor_id=${q.distributorId ?? null}::uuid)
          AND (${q.customerId ?? null}::uuid IS NULL OR t.customer_id=${q.customerId ?? null}::uuid)
          AND (${q.batchId ?? null}::uuid IS NULL OR t.import_batch_id=${q.batchId ?? null}::uuid)
          AND (${q.transactionId ?? null}::uuid IS NULL OR t.id=${q.transactionId ?? null}::uuid)
          AND (position(lower(${q.search ?? ''}) in lower(${code}))>0
            OR position(lower(${q.search ?? ''}) in lower(COALESCE(${name},'')))>0)
      ), page AS (
        SELECT * FROM subset ORDER BY billing_date ${Prisma.raw(q.direction)}, billing_document ${Prisma.raw(q.direction)}, billing_item ${Prisma.raw(q.direction)}, id ${Prisma.raw(q.direction)}
        LIMIT ${q.limit} OFFSET ${q.offset}
      )
      SELECT (SELECT COUNT(*)::int FROM subset) AS total,
        json_build_object('netRevenue',(SELECT COALESCE(SUM(net_amount),0)::numeric(30,2)::text FROM subset),
          'transactionCount',(SELECT COUNT(*)::int FROM subset),
          'units',COALESCE((SELECT json_agg(u ORDER BY unit) FROM
            (SELECT sales_unit AS unit,SUM(quantity)::numeric(30,3)::text AS quantity FROM subset GROUP BY sales_unit) u),'[]')) AS summary,
        COALESCE((SELECT json_agg(json_build_object(
          'id',id,'billingDocument',billing_document,'billingItem',billing_item,'billingDate',to_char(billing_date,'YYYY-MM-DD'),
          'billingType',billing_type,'cancelledBillingDocument',cancelled_billing_document,
          'productId',product_id,'sku',sku,'distributorId',distributor_id,'distributorCode',distributor_code,
          'customerId',customer_id,'customerCode',customer_code,'netAmount',net_amount::text,'currency',currency,
          'quantity',quantity::text,'unit',sales_unit,'batchId',import_batch_id,'sourceRowNumber',source_row_number,
          'fileName',file_name,'fileSha256',file_sha256,'templateVersionId',template_version_id,
          'rulesVersion',rules_version,'sourceFileStatus','NOT_RETAINED')
          ORDER BY billing_date ${Prisma.raw(q.direction)},billing_document ${Prisma.raw(q.direction)},billing_item ${Prisma.raw(q.direction)},id ${Prisma.raw(q.direction)}) FROM page),'[]') AS items
    `));
    return { organizationId: ctx.organizationId, from: q.from, to: q.to, currency: q.currency,
      limit: q.limit, offset: q.offset, ...result[0] };
  }
}
