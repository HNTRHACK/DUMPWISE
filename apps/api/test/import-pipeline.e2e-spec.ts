import { ForbiddenException, INestApplication } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { ImportPipelineService } from '../src/imports/import-pipeline.service.js';
import { PublicationBlockedException, PublicationService } from '../src/imports/publication.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SalesService } from '../src/sales/sales.service.js';
import { controlTotals, createTenant, createTestApp, csvOf, loadSyntheticDataset, type Tenant } from './helpers.js';

describe('Import pipeline (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let pipeline: ImportPipelineService;
  let publication: PublicationService;
  let sales: SalesService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    pipeline = app.get(ImportPipelineService);
    publication = app.get(PublicationService);
    sales = app.get(SalesService);
  });
  afterAll(async () => {
    await app.close();
  });

  const importAs = (t: Tenant, content: Buffer, ct: unknown, name = 'fixture.csv') =>
    pipeline.importBillingCsv({ organizationId: t.organizationId, actorUserId: t.analystId, fileName: name, content, controlTotals: ct });
  const txCount = (t: Tenant) => prisma.salesTransaction.count({ where: { organizationId: t.organizationId } });

  describe('full synthetic dataset', () => {
    const { csv, control } = loadSyntheticDataset();
    let tenant: Tenant;
    let batchId: string;

    it('imports the valid synthetic file and passes reconciliation', async () => {
      tenant = await createTenant(prisma);
      const r = await importAs(tenant, csv, control, 'SYNTHETIC_sap_billing.csv');
      batchId = r.batchId;
      expect(r.outcome).toBe('IMPORTED');
      expect(r.status).toBe('READY_TO_PUBLISH');
      expect(r.stats).toEqual({
        rowsTotal: control.expectedIssues.validUniqueRows + control.expectedIssues.exactDuplicateRows +
          control.expectedIssues.conflictingKeyRows + control.expectedIssues.invalidRows,
        rowsValid: control.expectedIssues.validUniqueRows,
        rowsInvalid: control.expectedIssues.invalidRows + control.expectedIssues.conflictingKeyRows,
        rowsDuplicateInFile: control.expectedIssues.exactDuplicateRows,
        rowsAlreadyImported: 0,
        rowsInserted: control.expectedIssues.validUniqueRows,
      });
      expect(r.reconciliation.length).toBeGreaterThan(0);
      expect(r.reconciliation.every((c) => c.passed)).toBe(true);
      expect(await txCount(tenant)).toBe(control.expectedIssues.validUniqueRows);
      // SAP identifiers keep their leading zeros.
      const product = await prisma.product.findFirst({ where: { organizationId: tenant.organizationId, sku: '000000000000010001' } });
      expect(product).not.toBeNull();
      const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
      expect(batch.isSynthetic).toBe(true);
    });

    it('is idempotent: re-importing the same file changes nothing', async () => {
      const before = await txCount(tenant);
      const r = await importAs(tenant, csv, control, 'renamed-copy.csv');
      expect(r.outcome).toBe('ALREADY_IMPORTED');
      expect(r.batchId).toBe(batchId);
      expect(await txCount(tenant)).toBe(before);
      expect(await prisma.importBatch.count({ where: { organizationId: tenant.organizationId } })).toBe(1);
    });

    it('aggregates months exactly to the independently generated totals', async () => {
      await publication.publish(tenant.organizationId, batchId, tenant.ownerId);
      const res = await sales.monthly({ organizationId: tenant.organizationId, userId: tenant.viewerId, role: 'VIEWER' }, {});

      expect(res.dataClassification).toBe('SYNTHETIC');
      expect(res.months.map((m) => `${m.month}|${m.currency}`)).toEqual(
        control.totals.map((t) => `${t.month}|${t.currency}`),
      );
      for (const t of control.totals) {
        const m = res.months.find((x) => x.month === t.month && x.currency === t.currency)!;
        expect(m.totalNetSales).toBe(t.netAmount);
        expect(m.transactionCount).toBe(t.lineCount);
      }
      // Control quantities are per (month, unit) across currencies.
      const units = new Map<string, Decimal>();
      for (const m of res.months) {
        for (const u of m.unitsSold) {
          const k = `${m.month}|${u.unit}`;
          units.set(k, (units.get(k) ?? new Decimal(0)).plus(u.quantity));
        }
      }
      for (const q of control.quantityTotals) {
        expect(units.get(`${q.month}|${q.unit}`)?.toFixed(3)).toBe(q.quantity);
      }
    });
  });

  describe('credit notes, returns and cancellations', () => {
    it('stores signed values and nets them in the monthly aggregate', async () => {
      const t = await createTenant(prisma);
      const csv = csvOf([
        { doc: '0090000001', qty: '10', amount: '1000.10' },
        { doc: '0090000002', qty: '5', amount: '500.20' },
        { doc: '0070000001', type: 'G2', qty: '10', amount: '0.30' },
        { doc: '0060000001', type: 'RE', qty: '1', amount: '100.01' },
        { doc: '0080000001', type: 'S1', qty: '5', amount: '500.20', cancelled: '0090000002' },
      ]);
      // Hand-calculated: 1000.10 + 500.20 - 0.30 - 100.01 - 500.20 = 899.79; units 10 + 5 + 0 - 1 - 5 = 9
      const r = await importAs(t, csv, controlTotals(
        [{ month: '2026-09', currency: 'INR', netAmount: '899.79', lineCount: 5 }],
        [{ month: '2026-09', unit: 'EA', quantity: '9.000' }],
      ));
      expect(r.outcome).toBe('IMPORTED');

      const stored = await prisma.salesTransaction.findMany({
        where: { organizationId: t.organizationId },
        orderBy: { billingDocument: 'asc' },
        select: { billingType: true, netAmount: true, quantity: true },
      });
      expect(stored.map((s) => [s.billingType, s.netAmount.toFixed(2), s.quantity.toFixed(3)])).toEqual([
        ['RE', '-100.01', '-1.000'],
        ['G2', '-0.30', '0.000'],
        ['S1', '-500.20', '-5.000'],
        ['F2', '1000.10', '10.000'],
        ['F2', '500.20', '5.000'],
      ]);

      await publication.publish(t.organizationId, r.batchId, t.ownerId);
      const res = await sales.monthly({ organizationId: t.organizationId, userId: t.ownerId, role: 'OWNER' }, {});
      expect(res.months).toEqual([
        { month: '2026-09', currency: 'INR', totalNetSales: '899.79', transactionCount: 5, unitsSold: [{ unit: 'EA', quantity: '9.000' }] },
      ]);
    });
  });

  describe('repeat and overlapping imports', () => {
    it('skips rows already imported, rejects changed rows, never overwrites', async () => {
      const t = await createTenant(prisma);
      const a = csvOf([
        { doc: '0090000001', amount: '100.00' },
        { doc: '0090000002', amount: '200.00' },
      ]);
      const r1 = await importAs(t, a, controlTotals(
        [{ month: '2026-09', currency: 'INR', netAmount: '300.00', lineCount: 2 }],
        [{ month: '2026-09', unit: 'EA', quantity: '2.000' }],
      ));
      expect(r1.outcome).toBe('IMPORTED');

      // Overlapping export: one identical row, one NEW row, one row whose value changed.
      const b = csvOf([
        { doc: '0090000001', amount: '100.00' },
        { doc: '0090000002', amount: '250.00' },
        { doc: '0090000003', amount: '50.00' },
      ]);
      const r2 = await importAs(t, b, controlTotals(
        [{ month: '2026-09', currency: 'INR', netAmount: '150.00', lineCount: 2 }],
        [{ month: '2026-09', unit: 'EA', quantity: '2.000' }],
      ));
      expect(r2.outcome).toBe('IMPORTED');
      expect(r2.stats).toMatchObject({ rowsAlreadyImported: 1, rowsInserted: 1, rowsInvalid: 1 });
      expect(r2.issues.map((i) => i.code)).toContain('CONFLICTS_WITH_EXISTING');

      const doc2 = await prisma.salesTransaction.findFirstOrThrow({
        where: { organizationId: t.organizationId, billingDocument: '0090000002' },
      });
      expect(doc2.netAmount.toFixed(2)).toBe('200.00'); // original value kept
      expect(await txCount(t)).toBe(3);
    });
  });

  describe('reconciliation failure', () => {
    it('rolls back the rows, records the evidence and blocks publication', async () => {
      const t = await createTenant(prisma);
      const csv = csvOf([{ doc: '0090000001', amount: '100.00' }]);
      const r = await importAs(t, csv, controlTotals(
        [{ month: '2026-09', currency: 'INR', netAmount: '100.01', lineCount: 1 }], // off by one paisa
        [{ month: '2026-09', unit: 'EA', quantity: '1.000' }],
      ));
      expect(r.outcome).toBe('RECONCILIATION_FAILED');
      expect(r.stats.rowsInserted).toBe(0);
      expect(r.reconciliation.filter((c) => !c.passed)).toEqual([
        expect.objectContaining({ metric: 'NET_AMOUNT', expected: '100.01', actual: '100.00' }),
      ]);
      expect(await txCount(t)).toBe(0);

      const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: r.batchId } });
      expect(batch).toMatchObject({ status: 'RECONCILIATION_FAILED', reconciliationStatus: 'FAILED' });
      expect(await prisma.reconciliationResult.count({ where: { importBatchId: r.batchId, passed: false } })).toBe(1);

      await expect(publication.publish(t.organizationId, r.batchId, t.ownerId)).rejects.toBeInstanceOf(PublicationBlockedException);
      const res = await sales.monthly({ organizationId: t.organizationId, userId: t.ownerId, role: 'OWNER' }, {});
      expect(res.months).toEqual([]);
      const blocked = await prisma.auditEvent.count({ where: { organizationId: t.organizationId, action: 'PUBLISH_BLOCKED' } });
      expect(blocked).toBe(1);
    });

    it('allows a corrected re-import after a failed one', async () => {
      const t = await createTenant(prisma);
      const csv = csvOf([{ doc: '0090000001', amount: '100.00' }]);
      const wrong = controlTotals([{ month: '2026-09', currency: 'INR', netAmount: '1.00', lineCount: 1 }], [{ month: '2026-09', unit: 'EA', quantity: '1.000' }]);
      const right = controlTotals([{ month: '2026-09', currency: 'INR', netAmount: '100.00', lineCount: 1 }], [{ month: '2026-09', unit: 'EA', quantity: '1.000' }]);
      expect((await importAs(t, csv, wrong)).outcome).toBe('RECONCILIATION_FAILED');
      expect((await importAs(t, csv, right)).outcome).toBe('IMPORTED');
    });
  });

  describe('guardrails', () => {
    it('rejects synthetic data in a PRODUCTION organization', async () => {
      const t = await createTenant(prisma, 'PRODUCTION');
      const r = await importAs(t, csvOf([{ doc: '1', amount: '1.00' }]), controlTotals(
        [{ month: '2026-09', currency: 'INR', netAmount: '1.00', lineCount: 1 }], [],
      ));
      expect(r.outcome).toBe('FAILED_VALIDATION');
      expect(r.issues[0].code).toBe('CLASSIFICATION_MISMATCH');
      expect(await txCount(t)).toBe(0);
    });

    it('fails validation when control totals are missing or malformed', async () => {
      const t = await createTenant(prisma);
      const r = await importAs(t, csvOf([{ doc: '1', amount: '1.00' }]), { totals: 'nope' });
      expect(r.outcome).toBe('FAILED_VALIDATION');
      expect(r.issues[0].code).toBe('INVALID_CONTROL_TOTALS');
    });

    it('does not let a VIEWER import or an ANALYST publish', async () => {
      const t = await createTenant(prisma);
      await expect(
        pipeline.importBillingCsv({ organizationId: t.organizationId, actorUserId: t.viewerId, fileName: 'x.csv', content: csvOf([{ doc: '1', amount: '1.00' }]), controlTotals: {} }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const r = await importAs(t, csvOf([{ doc: '1', amount: '1.00' }]), controlTotals(
        [{ month: '2026-09', currency: 'INR', netAmount: '1.00', lineCount: 1 }], [{ month: '2026-09', unit: 'EA', quantity: '1.000' }],
      ));
      await expect(publication.publish(t.organizationId, r.batchId, t.analystId)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
