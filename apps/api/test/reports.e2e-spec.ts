import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createTestApp, createTenant, fixtureDb, loginAs, csvOf, controlTotals, type Tenant } from './helpers.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TenantDb } from '../src/prisma/tenant-db.service.js';
import { ImportPipelineService } from '../src/imports/import-pipeline.service.js';
import { PublicationService } from '../src/imports/publication.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import * as generator from '../src/reports/report-files.js';

describe('private snapshot exports with real roles', () => {
  let app: INestApplication, admin: PrismaService, a: Tenant, b: Tenant, owner: string, viewer: string, id: string;
  const key = randomUUID();
  const query = { from: '2026-07', to: '2026-09', currency: 'INR', idempotencyKey: key };
  beforeAll(async () => {
    app = await createTestApp(); admin = fixtureDb(app); a = await createTenant(admin); b = await createTenant(admin);
    owner = (await loginAs(app, a.ownerId)).accessToken; viewer = (await loginAs(app, a.viewerId)).accessToken;
    const result = await app.get(ImportPipelineService).importBillingCsv({ organizationId: a.organizationId, actorUserId: a.analystId,
      fileName: '=SYNTHETIC.csv', content: csvOf([{ doc: '001', amount: '100', qty: '2' }, { doc: '002', type: 'G2', amount: '10' },
        { doc: '003', type: 'RE', amount: '20', qty: '1', unit: 'KG' }, { doc: '004', amount: '7', currency: 'USD' }]),
      controlTotals: controlTotals([{ month: '2026-09', currency: 'INR', netAmount: '70', lineCount: 3 },
        { month: '2026-09', currency: 'USD', netAmount: '7', lineCount: 1 }],
        [{ month: '2026-09', unit: 'EA', quantity: '3' }, { month: '2026-09', unit: 'KG', quantity: '-1' }]) });
    await app.get(PublicationService).publish(a.organizationId, result.batchId, a.ownerId);
  });
  afterAll(async () => app.close());
  const call = (method: 'get' | 'post', path: string, token?: string, org?: string) => request(app.getHttpServer())[method](path)
    .set('Authorization', `Bearer ${token ?? owner}`).set('X-Organization-Id', org ?? a.organizationId);

  it('rejects unauthorized roles/invalid periods and creates an idempotent reconciled snapshot', async () => {
    await call('post', '/v1/reports', viewer).send(query).expect(403);
    await call('post', '/v1/reports').send({ ...query, to: '2026-08' }).expect(400);
    await call('post', '/v1/reports').send({ ...query, currency: 'INR;DROP' }).expect(400);
    const [first, second] = await Promise.all([call('post', '/v1/reports').send(query).expect(201), call('post', '/v1/reports').send(query).expect(201)]);
    expect(first.body.id).toBe(second.body.id); id = first.body.id;
    expect(await admin.reportSnapshot.count({ where: { organizationId: a.organizationId } })).toBe(1);
    await call('post', '/v1/reports').send({ ...query, currency: 'USD' }).expect(409);
    const res = await call('get', `/v1/reports/${id}`).expect(200);
    const s = res.body.snapshot;
    expect(s).toMatchObject({ netRevenue: '70.00', credits: '10.00', returns: '20.00', transactionCount: 3, sourceFileStatus: 'NOT_RETAINED' });
    expect(s.units).toEqual([{ unit: 'EA', quantity: '2.000' }, { unit: 'KG', quantity: '-1.000' }]);
    const monthly = await call('get', '/v1/sales/monthly?from=2026-07&to=2026-09').expect(200);
    expect(monthly.body.months.find((r: { currency: string }) => r.currency === 'INR').totalNetSales).toBe(s.netRevenue);
    const analytics = await call('get', '/v1/analytics/products?from=2026-07&to=2026-09&currency=INR').expect(200);
    expect(analytics.body.summary.netRevenue).toBe(s.netRevenue);
    const bytes = await app.get(ReportsService).download({ organizationId: a.organizationId, userId: a.ownerId, role: 'OWNER' }, id, 'xlsx');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    expect(wb.getWorksheet('Report')!.getRows(1, 25)!.find(r => r.getCell(1).value === 'Net revenue')!.getCell(2).value).toBe(s.netRevenue);
    expect(wb.getWorksheet('Transactions')!.rowCount).toBe(4);
    expect(wb.getWorksheet('Source coverage')!.getCell('B2').value).toBe("'=SYNTHETIC.csv");
    const pptx = await app.get(ReportsService).download({ organizationId: a.organizationId, userId: a.ownerId, role: 'OWNER' }, id, 'pptx');
    const zip = await JSZip.loadAsync(pptx);
    const slide = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(slide).toContain('70.00'); expect(slide).toContain('<a:tbl>');
    await call('get', `/v1/reports/${id}/xlsx`).expect('Cache-Control', 'no-store').expect(200);
    await call('get', `/v1/reports/${id}/pptx`).expect(200);
  });

  it('keeps mixed currencies/units apart and handles no activity without invented growth', async () => {
    for (const config of [{ currency: 'USD' }, { unit: 'KG' }, { from: '2026-01', to: '2026-03' }]) {
      const res = await call('post', '/v1/reports').send({ ...query, ...config, idempotencyKey: randomUUID() }).expect(201);
      const detail = await call('get', `/v1/reports/${res.body.id}`).expect(200);
      expect(detail.body.snapshot.netRevenue).toBe('currency' in config ? '7.00' : 'unit' in config ? '-20.00' : '0.00');
      expect(detail.body.snapshot.products.every((r: { growthPercent: string | null }) => r.growthPercent === null)).toBe(true);
    }
  });

  it('publishes nothing on generation failure and enforces private tenant/expiry boundaries', async () => {
    const before = await admin.reportSnapshot.count({ where: { organizationId: a.organizationId } });
    const assessment = { manualMinutes: '90.50', automatedMinutes: '120.00', reviewed: false,
      discrepancies: [{ description: 'SYNTHETIC review pending', status: 'OPEN' }] };
    await call('post', `/v1/reports/${id}/pilot`, viewer).send(assessment).expect(403);
    await call('post', `/v1/reports/${id}/pilot`).send({ ...assessment, manualMinutes: '10081' }).expect(400);
    const first = await call('post', `/v1/reports/${id}/pilot`).send(assessment).expect(201);
    expect(first.body.laborMinutesDifference).toBe('-29.50');
    expect(first.body.durationSource).toBe('USER_ENTERED');
    await call('post', `/v1/reports/${id}/pilot`).send({ ...assessment, reviewed: true,
      discrepancies: [{ description: 'SYNTHETIC review completed', status: 'RESOLVED' }] }).expect(201);
    const history = await call('get', `/v1/reports/${id}/pilot`).expect(200);
    expect(history.body.items).toHaveLength(2);
    expect(history.body.items[0].reviewed).toBe(true);
    expect(history.body.items[1].discrepancies[0].status).toBe('OPEN');
    expect(history.body.reportEvidence).toMatchObject({ generatedExports: 2, checksPassed: 6, checksTotal: 6, reconciliationPassPercent: '100.00' });
    const spy = vi.spyOn(generator, 'reportFiles').mockRejectedValueOnce(new Error('SYNTHETIC generation failure'));
    try { await call('post', '/v1/reports').send({ ...query, idempotencyKey: randomUUID() }).expect(500); }
    finally { spy.mockRestore(); }
    expect(await admin.reportSnapshot.count({ where: { organizationId: a.organizationId } })).toBe(before);
    await call('get', `/v1/reports/${id}/xlsx`, viewer).expect(403);
    const bOwner = (await loginAs(app, b.ownerId)).accessToken;
    for (const suffix of ['', '/xlsx', '/pptx', '/pilot']) await call('get', `/v1/reports/${id}${suffix}`, bOwner, b.organizationId).expect(404);
    expect(await app.get(PrismaService).pilotAssessment.count()).toBe(0);
    expect(await app.get(PrismaService).reportSnapshot.count()).toBe(0);
    await expect(app.get(TenantDb).run({ organizationId: a.organizationId }, tx => tx.reportSnapshot.update({ where: { id }, data: { expiresAt: new Date() } }))).rejects.toThrow();
    // Test administrator changes ONLY a disposable fixture's clock window.
    await admin.reportSnapshot.update({ where: { id }, data: { createdAt: new Date(Date.now() - 9 * 86400000), expiresAt: new Date(Date.now() - 86400000) } });
    await call('get', `/v1/reports/${id}`).expect(404);
    await call('get', `/v1/reports/${id}/xlsx`).expect(404);
  });

  it('rejects large exports before generation; checks actual published synthetic facts', async () => {
    const c = await createTenant(admin);
    const result = await app.get(ImportPipelineService).importBillingCsv({ organizationId: c.organizationId,
      actorUserId: c.analystId, fileName: 'SYNTHETIC_limit.csv',
      content: csvOf(Array.from({ length: 5001 }, (_, n) => ({ doc: String(n + 1), amount: '1.00' }))),
      controlTotals: controlTotals([{ month: '2026-09', currency: 'INR', netAmount: '5001.00', lineCount: 5001 }],
        [{ month: '2026-09', unit: 'EA', quantity: '5001.000' }]) });
    expect(result.outcome).toBe('IMPORTED');
    await app.get(PublicationService).publish(c.organizationId, result.batchId, c.ownerId);
    await expect(app.get(ReportsService).create({ organizationId: c.organizationId, userId: c.ownerId, role: 'OWNER' },
      { ...query, idempotencyKey: randomUUID() })).rejects.toThrow('exceeds 5000');
    expect(await admin.reportSnapshot.count({ where: { organizationId: c.organizationId } })).toBe(0);
  });
});
