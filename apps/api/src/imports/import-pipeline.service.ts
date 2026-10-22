import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { ImportStatus, Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { controlTotalsSchema, type ControlTotals } from './parsing/control-totals.js';
import type { ImportIssue } from './parsing/issues.js';
import { businessKey, parseBillingFile } from './parsing/parse-billing-file.js';
import type { NormalizedRow } from './parsing/row-normalizer.js';
import type { NumberFormat } from './parsing/value-parsers.js';
import { reconcile, type ActualAggregateRow, type ReconciliationCheck } from './reconciliation.js';

export interface ImportInput {
  organizationId: string;
  actorUserId: string;
  fileName: string;
  content: Buffer;
  /** Parsed JSON of the control totals file (validated here). */
  controlTotals: unknown;
  numberFormat?: NumberFormat;
}

export interface ImportStats {
  rowsTotal: number;
  rowsValid: number;
  rowsInvalid: number;
  rowsDuplicateInFile: number;
  rowsAlreadyImported: number;
  rowsInserted: number;
}

export interface ImportOutcome {
  outcome: 'IMPORTED' | 'ALREADY_IMPORTED' | 'FAILED_VALIDATION' | 'RECONCILIATION_FAILED';
  batchId: string;
  status: ImportStatus;
  stats: ImportStats;
  reconciliation: ReconciliationCheck[];
  issues: ImportIssue[];
}

const MAX_STORED_ISSUES = 500;
const INSERT_CHUNK = 1000;

class ReconciliationFailed extends Error {
  constructor(
    readonly checks: ReconciliationCheck[],
    readonly stats: ImportStats,
    readonly issues: ImportIssue[],
  ) {
    super('Reconciliation failed');
  }
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class ImportPipelineService {
  private readonly logger = new Logger(ImportPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly access: OrganizationAccessService,
    private readonly audit: AuditService,
  ) {}

  /**
   * CSV -> header recognition -> type conversion -> validation -> duplicate detection
   * -> database import -> monthly aggregation -> reconciliation.
   * Rows are only kept if reconciliation passes; otherwise the import is rolled back and
   * the failed batch (with its reconciliation evidence) is recorded on its own.
   */
  async importBillingCsv(input: ImportInput): Promise<ImportOutcome> {
    const { organizationId, actorUserId } = input;
    await this.access.require(actorUserId, organizationId, ['OWNER', 'ANALYST']);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });

    const fileSha256 = createHash('sha256').update(input.content).digest('hex');
    const meta = {
      organizationId,
      fileSha256,
      fileName: basename(input.fileName).slice(0, 255),
      fileSizeBytes: input.content.length,
      isSynthetic: org.dataClassification === 'SYNTHETIC',
      createdByUserId: actorUserId,
    };

    const previous = await this.findSuccessfulBatch(this.prisma, organizationId, fileSha256);
    if (previous) return this.alreadyImported(previous);

    // Stage: validate control totals and the data classification rule.
    const fileIssues: ImportIssue[] = [];
    const ct = controlTotalsSchema.safeParse(input.controlTotals);
    if (!ct.success) {
      fileIssues.push({
        severity: 'error',
        code: 'INVALID_CONTROL_TOTALS',
        message: `Control totals file is invalid: ${ct.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      });
    } else if (ct.data.synthetic !== meta.isSynthetic) {
      fileIssues.push({
        severity: 'error',
        code: 'CLASSIFICATION_MISMATCH',
        message: ct.data.synthetic
          ? 'Synthetic data may only be imported into a SYNTHETIC organization.'
          : 'A SYNTHETIC organization only accepts synthetic data.',
      });
    }

    // Stages 1-4 (pure): CSV, headers, types, validation, in-file duplicates.
    const parsed = parseBillingFile(
      input.content,
      {
        maxBytes: this.config.get('IMPORT_MAX_BYTES', { infer: true }),
        maxRows: this.config.get('IMPORT_MAX_ROWS', { infer: true }),
      },
      input.numberFormat ?? 'PLAIN',
    );

    if (!parsed.ok || fileIssues.length > 0 || !ct.success) {
      const issues = [...fileIssues, ...parsed.issues];
      const stats = { ...parsed.stats, rowsAlreadyImported: 0, rowsInserted: 0 };
      const batch = await this.prisma.$transaction(async (tx) => {
        const b = await tx.importBatch.create({
          data: { ...meta, status: 'FAILED_VALIDATION', ...stats, issues: issuesJson(issues) },
        });
        await this.audit.record(
          { organizationId, actorUserId, action: 'IMPORT_FAILED_VALIDATION', entityType: 'ImportBatch', entityId: b.id, metadata: { fileSha256, issueCounts: countIssues(issues) } },
          tx,
        );
        return b;
      });
      return { outcome: 'FAILED_VALIDATION', batchId: batch.id, status: batch.status, stats, reconciliation: [], issues: cap(issues) };
    }

    try {
      return await this.prisma.$transaction(
        (tx) => this.importInTransaction(tx, meta, parsed.rows, parsed.stats, parsed.issues, ct.data, actorUserId),
        { timeout: 120_000, maxWait: 15_000 },
      );
    } catch (e) {
      if (!(e instanceof ReconciliationFailed)) throw e;
      // The transaction above was rolled back: no transaction rows were kept.
      const batch = await this.prisma.$transaction(async (tx) => {
        const b = await tx.importBatch.create({
          data: {
            ...meta,
            status: 'RECONCILIATION_FAILED',
            reconciliationStatus: 'FAILED',
            ...e.stats,
            rowsInserted: 0,
            issues: issuesJson(e.issues),
          },
        });
        await tx.reconciliationResult.createMany({ data: e.checks.map((c) => toResult(c, organizationId, b.id)) });
        await this.audit.record(
          { organizationId, actorUserId, action: 'IMPORT_RECONCILIATION_FAILED', entityType: 'ImportBatch', entityId: b.id, metadata: { fileSha256, failedChecks: e.checks.filter((c) => !c.passed).length } },
          tx,
        );
        return b;
      });
      this.logger.warn(`Batch ${batch.id} failed reconciliation; publication blocked`);
      return {
        outcome: 'RECONCILIATION_FAILED',
        batchId: batch.id,
        status: batch.status,
        stats: { ...e.stats, rowsInserted: 0 },
        reconciliation: e.checks,
        issues: cap(e.issues),
      };
    }
  }

  private async importInTransaction(
    tx: Tx,
    meta: { organizationId: string; fileSha256: string; fileName: string; fileSizeBytes: number; isSynthetic: boolean; createdByUserId: string },
    rows: NormalizedRow[],
    parsedStats: Omit<ImportStats, 'rowsAlreadyImported' | 'rowsInserted'>,
    parsedIssues: ImportIssue[],
    controlTotals: ControlTotals,
    actorUserId: string,
  ): Promise<ImportOutcome> {
    const { organizationId } = meta;
    // Serialize imports per organization so two concurrent uploads cannot race on the
    // same business keys. The lock is released automatically at commit/rollback.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`;

    const previous = await this.findSuccessfulBatch(tx, organizationId, meta.fileSha256);
    if (previous) return this.alreadyImported(previous);

    const batch = await tx.importBatch.create({ data: { ...meta, status: 'PROCESSING' } });
    const ids = await this.upsertMasterData(tx, organizationId, rows);

    // Stage: duplicate detection against data already in the database.
    const existing = await this.findExistingHashes(tx, organizationId, rows);
    const issues = [...parsedIssues];
    const toInsert: NormalizedRow[] = [];
    const accepted: NormalizedRow[] = [];
    let alreadyImported = 0;
    let conflicts = 0;
    for (const row of rows) {
      const hash = existing.get(businessKey(row));
      if (hash === undefined) {
        toInsert.push(row);
        accepted.push(row);
      } else if (hash === row.contentHash) {
        alreadyImported++;
        accepted.push(row);
      } else {
        conflicts++;
        issues.push({
          severity: 'error',
          code: 'CONFLICTS_WITH_EXISTING',
          line: row.line,
          message: `Billing document/item ${businessKey(row)} was already imported with different values; row rejected (existing data is never overwritten).`,
        });
      }
    }

    // Stage: database import.
    for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
      await tx.salesTransaction.createMany({
        data: toInsert.slice(i, i + INSERT_CHUNK).map((r) => ({
          organizationId,
          importBatchId: batch.id,
          billingDocument: r.billingDocument,
          billingItem: r.billingItem,
          billingType: r.billingType,
          billingDate: new Date(`${r.billingDate}T00:00:00.000Z`),
          cancelledBillingDocument: r.cancelledDocument,
          distributorId: ids.distributors.get(r.distributorCode)!,
          productId: ids.products.get(r.sku)!,
          customerId: ids.customers.get(r.customerCode)!,
          quantity: r.quantity,
          salesUnit: r.salesUnit,
          netAmount: r.netAmount,
          currency: r.currency,
          contentHash: r.contentHash,
          sourceRowNumber: r.line,
        })),
      });
    }

    const stats: ImportStats = {
      ...parsedStats,
      rowsValid: parsedStats.rowsValid - conflicts,
      rowsInvalid: parsedStats.rowsInvalid + conflicts,
      rowsAlreadyImported: alreadyImported,
      rowsInserted: toInsert.length,
    };

    // Stages: monthly aggregation (in SQL, over what is actually stored) + reconciliation.
    const actual = await this.aggregateAccepted(tx, organizationId, accepted);
    const checks = reconcile(controlTotals, actual);
    if (checks.some((c) => !c.passed)) throw new ReconciliationFailed(checks, stats, issues);

    await tx.reconciliationResult.createMany({ data: checks.map((c) => toResult(c, organizationId, batch.id)) });
    const updated = await tx.importBatch.update({
      where: { id: batch.id },
      data: { status: 'READY_TO_PUBLISH', reconciliationStatus: 'PASSED', ...stats, issues: issuesJson(issues) },
    });
    await this.audit.record(
      { organizationId, actorUserId, action: 'IMPORT_COMPLETED', entityType: 'ImportBatch', entityId: batch.id, metadata: { fileSha256: meta.fileSha256, ...stats } },
      tx,
    );
    return { outcome: 'IMPORTED', batchId: batch.id, status: updated.status, stats, reconciliation: checks, issues: cap(issues) };
  }

  private findSuccessfulBatch(db: Tx | PrismaService, organizationId: string, fileSha256: string) {
    return db.importBatch.findFirst({
      where: { organizationId, fileSha256, status: { in: ['READY_TO_PUBLISH', 'PUBLISHED'] } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private alreadyImported(b: NonNullable<Awaited<ReturnType<ImportPipelineService['findSuccessfulBatch']>>>): ImportOutcome {
    return {
      outcome: 'ALREADY_IMPORTED',
      batchId: b.id,
      status: b.status,
      stats: {
        rowsTotal: b.rowsTotal, rowsValid: b.rowsValid, rowsInvalid: b.rowsInvalid,
        rowsDuplicateInFile: b.rowsDuplicateInFile, rowsAlreadyImported: b.rowsAlreadyImported, rowsInserted: 0,
      },
      reconciliation: [],
      issues: [],
    };
  }

  private async upsertMasterData(tx: Tx, organizationId: string, rows: NormalizedRow[]) {
    const uniq = <T>(items: [string, T][]) => [...new Map(items).entries()];
    const dists = uniq(rows.map((r) => [r.distributorCode, r.distributorName]));
    const prods = uniq(rows.map((r) => [r.sku, r.productDescription]));
    const custs = uniq(rows.map((r) => [r.customerCode, null]));

    // Insert unknown master records; existing ones are left untouched.
    await tx.distributor.createMany({ data: dists.map(([code, name]) => ({ organizationId, code, name })), skipDuplicates: true });
    await tx.product.createMany({ data: prods.map(([sku, description]) => ({ organizationId, sku, description })), skipDuplicates: true });
    await tx.customer.createMany({ data: custs.map(([code]) => ({ organizationId, code })), skipDuplicates: true });

    const [d, p, c] = await Promise.all([
      tx.distributor.findMany({ where: { organizationId, code: { in: dists.map(([k]) => k) } }, select: { id: true, code: true } }),
      tx.product.findMany({ where: { organizationId, sku: { in: prods.map(([k]) => k) } }, select: { id: true, sku: true } }),
      tx.customer.findMany({ where: { organizationId, code: { in: custs.map(([k]) => k) } }, select: { id: true, code: true } }),
    ]);
    return {
      distributors: new Map(d.map((x) => [x.code, x.id])),
      products: new Map(p.map((x) => [x.sku, x.id])),
      customers: new Map(c.map((x) => [x.code, x.id])),
    };
  }

  private async findExistingHashes(tx: Tx, organizationId: string, rows: NormalizedRow[]) {
    const found = await tx.$queryRaw<{ billing_document: string; billing_item: string; content_hash: string }[]>`
      SELECT t.billing_document, t.billing_item, t.content_hash
      FROM sales_transactions t
      JOIN unnest(${rows.map((r) => r.billingDocument)}::text[], ${rows.map((r) => r.billingItem)}::text[]) AS k(doc, item)
        ON t.billing_document = k.doc AND t.billing_item = k.item
      WHERE t.organization_id = ${organizationId}::uuid`;
    return new Map(found.map((f) => [`${f.billing_document}/${f.billing_item}`, f.content_hash]));
  }

  private aggregateAccepted(tx: Tx, organizationId: string, rows: NormalizedRow[]) {
    return tx.$queryRaw<ActualAggregateRow[]>`
      SELECT to_char(t.billing_date, 'YYYY-MM') AS month,
             t.currency,
             t.sales_unit AS unit,
             SUM(t.net_amount)::text AS net,
             COUNT(*)::int AS lines,
             SUM(t.quantity)::text AS qty
      FROM sales_transactions t
      JOIN unnest(${rows.map((r) => r.billingDocument)}::text[], ${rows.map((r) => r.billingItem)}::text[]) AS k(doc, item)
        ON t.billing_document = k.doc AND t.billing_item = k.item
      WHERE t.organization_id = ${organizationId}::uuid
      GROUP BY 1, 2, 3`;
  }
}

function toResult(c: ReconciliationCheck, organizationId: string, importBatchId: string) {
  return {
    organizationId,
    importBatchId,
    metric: c.metric,
    month: c.month,
    currency: c.currency,
    unit: c.unit,
    expectedValue: c.expected,
    actualValue: c.actual,
    passed: c.passed,
  };
}

function cap(issues: ImportIssue[]): ImportIssue[] {
  return issues.slice(0, MAX_STORED_ISSUES);
}

function countIssues(issues: ImportIssue[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of issues) out[i.code] = (out[i.code] ?? 0) + 1;
  return out;
}

/** ImportIssue is plain JSON data; Prisma's Json input type just cannot infer that. */
function issuesJson(issues: ImportIssue[]): Prisma.InputJsonValue {
  return cap(issues) as unknown as Prisma.InputJsonValue;
}
