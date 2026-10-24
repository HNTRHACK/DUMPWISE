import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationAccessService, type OrganizationAccess } from '../auth/organization-access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantDb } from '../prisma/tenant-db.service.js';
import { periods } from '../analytics/analytics.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { reportFiles } from './report-files.js';
import { REPORT_DEFINITION_VERSION, summarizeSnapshot, type ReportFact, type ReportSnapshotData, type ReportSource } from './report-snapshot.js';
import type { CreateReportDto } from './reports.dto.js';
import type { PilotAssessmentDto } from './reports.dto.js';
import { Decimal } from 'decimal.js';

export const MAX_REPORT_FACTS = 5000; // Includes comparison period; larger workloads need durable jobs.
const RETENTION_MS = 7 * 86400000;
const summarySelect = { id: true, configuration: true, createdAt: true, expiresAt: true } as const;

@Injectable()
export class ReportsService {
  constructor(private readonly db: TenantDb, private readonly access: OrganizationAccessService, private readonly audit: AuditService) {}

  async create(ctx: OrganizationAccess, q: CreateReportDto) {
    await this.access.require(ctx.userId, ctx.organizationId, ['OWNER', 'ANALYST']);
    const p = periods(q);
    if (![3, 6, 12].includes(p.count)) throw new BadRequestException('Management reports require 3, 6 or 12 calendar months');
    const configuration = { from: q.from, to: q.to, currency: q.currency, unit: q.unit ?? null, definitionVersion: REPORT_DEFINITION_VERSION };
    return this.db.run(ctx, async tx => {
      // Serializes requests for one organization's same idempotency key before any file work.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.organizationId + q.idempotencyKey}, 0))`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '20000ms'`;
      const previous = await tx.reportSnapshot.findFirst({ where: { organizationId: ctx.organizationId, idempotencyKey: q.idempotencyKey }, select: summarySelect });
      if (previous) {
        const old = previous.configuration as typeof configuration;
        if (Object.keys(configuration).some(key => old[key as keyof typeof old] !== configuration[key as keyof typeof configuration])) throw new ConflictException('Idempotency key already used for a different report configuration');
        if (previous.expiresAt.getTime() <= Date.now()) throw new ConflictException('Snapshot expired; use a new idempotency key');
        return previous;
      }
      // All evidence is read in ONE statement snapshot, after the idempotency lock.
      // Bound the current+comparison facts before materializing JSON or generating files.
      const [data] = await tx.$queryRaw<{ facts: ReportFact[]; sources: ReportSource[]; checkCount: number; organizationName: string; classification: string; generatedAt: string }[]>`
        WITH facts AS (
          SELECT t.*, p.sku, d.code AS distributor, c.code AS customer, b.template_version_id,b.rules_version
          FROM sales_transactions t
          JOIN import_batches b ON b.organization_id=t.organization_id AND b.id=t.import_batch_id
          JOIN products p ON p.organization_id=t.organization_id AND p.id=t.product_id
          JOIN distributors d ON d.organization_id=t.organization_id AND d.id=t.distributor_id
          JOIN customers c ON c.organization_id=t.organization_id AND c.id=t.customer_id
          WHERE t.organization_id=${ctx.organizationId}::uuid AND b.status='PUBLISHED' AND b.reconciliation_status='PASSED'
            AND t.billing_date>=${p.previous}::date AND t.billing_date<${p.end}::date AND t.currency=${q.currency}
            AND (${q.unit ?? null}::text IS NULL OR t.sales_unit=${q.unit ?? null})
          ORDER BY t.billing_date,t.id LIMIT ${MAX_REPORT_FACTS + 1}
        ), batches AS (
          SELECT b.* FROM import_batches b WHERE b.organization_id=${ctx.organizationId}::uuid
            AND b.id IN (SELECT import_batch_id FROM facts) ORDER BY b.id LIMIT 101
        ), checks AS (
          SELECT r.* FROM reconciliation_results r JOIN batches b ON b.organization_id=r.organization_id AND b.id=r.import_batch_id
          ORDER BY r.id LIMIT 5001
        )
        SELECT (SELECT name FROM organizations WHERE id=${ctx.organizationId}::uuid) AS "organizationName",
          (SELECT COUNT(*)::int FROM checks) AS "checkCount",
          (SELECT data_classification FROM organizations WHERE id=${ctx.organizationId}::uuid) AS classification,
          statement_timestamp()::text AS "generatedAt",
          COALESCE((SELECT json_agg(json_build_object('id',id,'date',to_char(billing_date,'YYYY-MM-DD'),
            'document',billing_document,'item',billing_item,'type',billing_type,'sku',sku,'distributor',distributor,'customer',customer,
            'amount',net_amount::text,'quantity',quantity::text,'currency',currency,'unit',sales_unit,'batchId',import_batch_id,
            'line',source_row_number,'templateVersionId',template_version_id,'rulesVersion',rules_version) ORDER BY billing_date,id) FROM facts),'[]') AS facts,
          COALESCE((SELECT json_agg(json_build_object('id',b.id,'fileName',b.file_name,'sha256',b.file_sha256,
            'publishedAt',b.published_at,'accepted',b.rows_valid,'rejected',b.rows_invalid,'duplicates',b.rows_duplicate_in_file,
            'inserted',b.rows_inserted,'templateVersionId',b.template_version_id,'rulesVersion',b.rules_version,
            'checks',COALESCE((SELECT json_agg(json_build_object('metric',r.metric,'month',r.month,'currency',r.currency,'unit',r.unit,
              'expected',r.expected_value::text,'actual',r.actual_value::text,'passed',r.passed) ORDER BY r.month,r.metric,r.currency,r.unit)
              FROM checks r WHERE r.organization_id=b.organization_id AND r.import_batch_id=b.id),'[]')) ORDER BY b.id) FROM batches b),'[]') AS sources`;
      if (data.facts.length > MAX_REPORT_FACTS) throw new BadRequestException(`Report exceeds ${MAX_REPORT_FACTS} current/comparison facts; narrow the range or unit. Large exports require background jobs.`);
      if (data.sources.length > 100 || data.checkCount > 5000) throw new BadRequestException('Report exceeds 100 source batches or 5000 reconciliation checks; narrow the period');
      if (data.sources.some(b => !b.checks.length || b.checks.some(c => !c.passed))) throw new ConflictException('Published source has inconsistent reconciliation evidence; report blocked');
      const snapshot = summarizeSnapshot({ organizationId: ctx.organizationId, organizationName: data.organizationName,
        classification: data.classification, generatedAt: new Date(data.generatedAt).toISOString(), from: q.from, to: q.to,
        currency: q.currency, unit: q.unit ?? null, previousFrom: p.previousFrom, previousTo: p.previousTo,
        sources: data.sources, transactions: [] }, data.facts, p.count);
      // Atomic publication: if either format fails, no report row or audit event is committed.
      const files = await reportFiles(snapshot);
      const row = await tx.reportSnapshot.create({ data: { organizationId: ctx.organizationId, idempotencyKey: q.idempotencyKey,
        configuration, snapshot: snapshot as unknown as Prisma.InputJsonValue, ...files, createdByUserId: ctx.userId,
        expiresAt: new Date(Date.now() + RETENTION_MS) }, select: summarySelect });
      await this.audit.record({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: 'REPORT_GENERATED',
        entityType: 'ReportSnapshot', entityId: row.id, metadata: { definitionVersion: REPORT_DEFINITION_VERSION,
          lines: snapshot.transactionCount, sources: snapshot.sources.length } }, tx);
      return row;
    }, { timeout: 60000, maxWait: 5000 });
  }

  async list(ctx: OrganizationAccess, limit: number, offset: number) {
    await this.access.require(ctx.userId, ctx.organizationId, ['OWNER', 'ANALYST']);
    return this.db.run(ctx, async tx => ({ items: await tx.reportSnapshot.findMany({
      where: { organizationId: ctx.organizationId, expiresAt: { gt: new Date() } }, select: summarySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit, skip: offset }), limit, offset }));
  }

  async get(ctx: OrganizationAccess, id: string) {
    await this.access.require(ctx.userId, ctx.organizationId, ['OWNER', 'ANALYST']);
    const row = await this.db.run(ctx, tx => tx.reportSnapshot.findFirst({ where: { organizationId: ctx.organizationId, id, expiresAt: { gt: new Date() } },
      select: { ...summarySelect, snapshot: true } }));
    if (!row) throw new NotFoundException('Report not found or expired');
    const { transactions: _details, ...snapshot } = row.snapshot as unknown as ReportSnapshotData;
    return { ...row, snapshot: { ...snapshot, products: snapshot.products.slice(0, 8),
      distributors: snapshot.distributors.slice(0, 8), customers: snapshot.customers.slice(0, 8) } };
  }

  async download(ctx: OrganizationAccess, id: string, format: 'xlsx' | 'pptx') {
    await this.access.require(ctx.userId, ctx.organizationId, ['OWNER', 'ANALYST']);
    const row = await this.db.run(ctx, tx => tx.reportSnapshot.findFirst({ where: { organizationId: ctx.organizationId, id, expiresAt: { gt: new Date() } },
      select: format === 'xlsx' ? { xlsx: true } : { pptx: true } }));
    if (!row) throw new NotFoundException('Report not found or expired');
    return Buffer.from(row[format]!);
  }

  async assess(ctx: OrganizationAccess, id: string, input: PilotAssessmentDto) {
    await this.get(ctx, id);
    if (new Decimal(input.manualMinutes).gt(10080) || new Decimal(input.automatedMinutes).gt(10080)) throw new BadRequestException('Minutes must be 0 to 10080');
    return this.db.run(ctx, async tx => {
      const row = await tx.pilotAssessment.create({ data: { organizationId: ctx.organizationId, reportId: id,
        manualMinutes: input.manualMinutes, automatedMinutes: input.automatedMinutes, reviewed: input.reviewed,
        discrepancies: input.discrepancies.map(d => ({ description: d.description, status: d.status })), createdByUserId: ctx.userId } });
      await this.audit.record({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: 'PILOT_ASSESSED',
        entityType: 'PilotAssessment', entityId: row.id, metadata: { reportId: id, reviewed: input.reviewed, discrepancyCount: input.discrepancies.length } }, tx);
      return { ...row, manualMinutes: row.manualMinutes.toFixed(2), automatedMinutes: row.automatedMinutes.toFixed(2),
        laborMinutesDifference: row.manualMinutes.minus(row.automatedMinutes).toFixed(2), durationSource: 'USER_ENTERED' };
    });
  }

  async assessments(ctx: OrganizationAccess, id: string, limit: number, offset: number) {
    const report = await this.get(ctx, id);
    const items = await this.db.run(ctx, tx => tx.pilotAssessment.findMany({ where: { organizationId: ctx.organizationId, reportId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit, skip: offset }));
    const s = report.snapshot;
    const checks = s.sources.flatMap(b => b.checks);
    return { reportId: id, durationSource: 'USER_ENTERED', limit, offset,
      reportEvidence: { generatedExports: 2, sourceBatches: s.sources.length, activityMonths: s.months.length,
        acceptedBatchRows: s.sources.reduce((n, b) => n + b.accepted, 0), rejectedBatchRows: s.sources.reduce((n, b) => n + b.rejected, 0),
        checksPassed: checks.filter(c => c.passed).length, checksTotal: checks.length,
        reconciliationPassPercent: checks.length ? new Decimal(checks.filter(c => c.passed).length).div(checks.length).times(100).toFixed(2) : null },
      items: items.map(row => ({ ...row, manualMinutes: row.manualMinutes.toFixed(2), automatedMinutes: row.automatedMinutes.toFixed(2),
        laborMinutesDifference: row.manualMinutes.minus(row.automatedMinutes).toFixed(2) })),
    };
  }
}
