import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { ImportPipelineService } from '../src/imports/import-pipeline.service.js';
import { PublicationService } from '../src/imports/publication.service.js';
import { AnalyticsService } from '../src/analytics/analytics.service.js';
import { AnalyticsQueryDto } from '../src/analytics/analytics.dto.js';
import { OrganizationAccessService } from '../src/auth/organization-access.service.js';
import { TenantDb } from '../src/prisma/tenant-db.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { controlTotals, createTenant, createTestApp, csvOf, fixtureDb, loginAs, type Tenant } from './helpers.js';

describe('published analytics (real PostgreSQL)', () => {
  let app: INestApplication, fixture: PrismaService, a: Tenant, b: Tenant, token: string, product: string;
  const query = { from: '2026-09', to: '2026-09', currency: 'INR' };
  const get = (path = 'products', q: Record<string, unknown> = query, org?: string) => request(app.getHttpServer())
    .get(`/v1/analytics/${path}`).auth(token, { type: 'bearer' }).set('x-organization-id', org ?? a.organizationId).query(q);
  beforeAll(async () => {
    app = await createTestApp(); fixture = fixtureDb(app); a = await createTenant(fixture); b = await createTenant(fixture);
    token = (await loginAs(app, a.viewerId)).accessToken;
    const csv = csvOf([
      { date: '15.08.2026', doc: '1', sku: 'SYN-A', amount: '50', qty: '5' },
      { date: '15.08.2026', doc: '2', sku: 'SYN-A', amount: '40', qty: '4', unit: 'KG' },
      { date: '15.08.2026', doc: '3', sku: 'SYN-B', amount: '0', qty: '0', unit: 'KG' },
      { doc: '4', sku: 'SYN-A', amount: '100', qty: '10' },
      { doc: '5', sku: 'SYN-A', amount: '10', type: 'G2' },
      { doc: '6', sku: 'SYN-A', amount: '20', qty: '2', type: 'RE' },
      { doc: '7', sku: 'SYN-A', amount: '5', qty: '1', type: 'S1', cancelled: '4' },
      { doc: '8', sku: 'SYN-A', amount: '100', qty: '10', unit: 'KG' },
      { doc: '9', sku: 'SYN-B', amount: '200', qty: '20', unit: 'KG' },
      { doc: '10', sku: 'SYN-A', amount: '30', qty: '3', currency: 'USD' },
    ]).toString().split('\n').map(line => line.includes('SYN-B') ? line.replace('0000100001', '0000100002').replace('0000200001', '0000200002') : line).join('\n');
    const result = await app.get(ImportPipelineService).importBillingCsv({ organizationId: a.organizationId, actorUserId: a.analystId, fileName: 'SYNTHETIC_analytics.csv', content: Buffer.from(csv), controlTotals: controlTotals([
      { month: '2026-08', currency: 'INR', netAmount: '90.00', lineCount: 3 },
      { month: '2026-09', currency: 'INR', netAmount: '365.00', lineCount: 6 },
      { month: '2026-09', currency: 'USD', netAmount: '30.00', lineCount: 1 },
    ], [
      { month: '2026-08', unit: 'EA', quantity: '5.000' }, { month: '2026-08', unit: 'KG', quantity: '4.000' },
      { month: '2026-09', unit: 'EA', quantity: '10.000' }, { month: '2026-09', unit: 'KG', quantity: '30.000' },
    ]) });
    expect(result.outcome).toBe('IMPORTED');
    expect((await get()).body.total).toBe(0);
    await app.get(PublicationService).publish(a.organizationId, result.batchId, a.ownerId);
    product = (await fixture.product.findFirstOrThrow({ where: { organizationId: a.organizationId, sku: 'SYN-A' } })).id;
  });
  afterAll(async () => { await app.close(); });

  it.each(['products', 'distributors', 'customers'])('aggregates %s with exact revenue, signed quantities and separated credits', async path => {
    const { body } = await get(path).expect(200);
    expect(body.total).toBe(3);
    expect(body.summary).toMatchObject({ netRevenue: '365.00', creditedAmount: '10.00', returnedAmount: '20.00', cancelledAmount: '5.00', transactionCount: 6, units: [{ unit: 'EA', quantity: '7.000' }, { unit: 'KG', quantity: '30.000' }] });
    expect(body.items.find((r: { unit: string }) => r.unit === 'EA')).toMatchObject({ netRevenue: '65.00', growthPercent: '30.00', netQuantity: '7.000' });
  });
  it('separates currencies, units and filters; pagination uses deterministic ties and unpaged totals', async () => {
    expect((await get('products', { ...query, currency: 'USD' })).body.summary.netRevenue).toBe('30.00');
    const one = await get('products', { ...query, limit: 1, sort: 'netRevenue', direction: 'desc' }).expect(200);
    expect(one.body.items[0].netRevenue).toBe('200.00'); expect(one.body.summary.netRevenue).toBe('365.00');
    const two = await get('products', { ...query, limit: 1, offset: 1 }).expect(200);
    expect(two.body.items[0].netRevenue).toBe('100.00');
    expect((await get('products', { ...query, unit: 'EA' })).body.total).toBe(1);
    expect((await get('products', { ...query, search: 'syn-b' })).body.items[0].growthReason).toBe('Previous revenue is zero or negative');
    expect((await get('products', { ...query, search: "%' OR 1=1 --" })).body.total).toBe(0);
    expect((await get('products', { ...query, from: '2026-08' })).body.items[0].growthPercent).toBeNull();
  });
  it('returns product trends without replacing absent months with zero', async () => {
    const res = await get(`products/${product}/trend`, { ...query, from: '2026-07' }).expect(200);
    expect(res.body.months.map((m: { month: string }) => m.month)).toEqual(['2026-08', '2026-09']);
    expect(res.body.months[1].totalNetSales).toBe('165.00');
    expect(res.body.months[1].unitsSold).toEqual([{ unit: 'EA', quantity: '7.000' }, { unit: 'KG', quantity: '10.000' }]);
  });
  it('supports returns-only negative periods without treating quantity as positive sales', async () => {
    const result = await app.get(ImportPipelineService).importBillingCsv({ organizationId: a.organizationId, actorUserId: a.analystId, fileName: 'SYNTHETIC_returns.csv',
      content: csvOf([{ date: '15.10.2026', doc: '11', sku: 'SYN-A', amount: '200', qty: '20', type: 'RE' }]),
      controlTotals: controlTotals([{ month: '2026-10', currency: 'INR', netAmount: '-200.00', lineCount: 1 }], [{ month: '2026-10', unit: 'EA', quantity: '-20.000' }]) });
    expect(result.outcome).toBe('IMPORTED');
    await app.get(PublicationService).publish(a.organizationId, result.batchId, a.ownerId);
    const res = await get('products', { ...query, from: '2026-10', to: '2026-10' }).expect(200);
    expect(res.body.items[0]).toMatchObject({ netRevenue: '-200.00', returnedAmount: '200.00', netQuantity: '-20.000', growthPercent: '-407.69' });
  });
  it('requires both publication and successful reconciliation', async () => {
    const batch = await fixture.importBatch.findFirstOrThrow({ where: { organizationId: a.organizationId, fileName: 'SYNTHETIC_analytics.csv' } });
    await fixture.importBatch.update({ where: { id: batch.id }, data: { reconciliationStatus: 'FAILED' } });
    try { expect((await get().expect(200)).body.total).toBe(0); }
    finally { await fixture.importBatch.update({ where: { id: batch.id }, data: { reconciliationStatus: 'PASSED' } }); }
  });
  it.each([{ sort: 'DROP TABLE users' }, { sort: 'netQuantity' }, { offset: -1 }, { limit: 101 }, { unit: 'KG;--' }, { currency: 'inr' }, { from: '2026-13' }, { from: '2020-01' }, { from: '2027-01' }, { organizationId: 'extra' }])('rejects unsafe query %j', async extra => {
    await get('products', { ...query, ...extra }).expect(400);
  });
  it('denies anonymous and cross-tenant requests, including direct service calls', async () => {
    await request(app.getHttpServer()).get('/v1/analytics/products').query(query).expect(401);
    await get('products', query, b.organizationId).expect(403);
    await get(`products/${product}/trend`, query, b.organizationId).expect(403);
    const btoken = (await loginAs(app, b.viewerId)).accessToken;
    await request(app.getHttpServer()).get(`/v1/analytics/products/${product}/trend`).auth(btoken, { type: 'bearer' }).set('x-organization-id', b.organizationId).query(query).expect(404);
    await expect(app.get(AnalyticsService).list({ userId: a.viewerId, organizationId: b.organizationId, role: 'OWNER' }, 'products', Object.assign(new AnalyticsQueryDto(), query))).rejects.toThrow('No access');
  });
  it('preserves RLS fail-closed and transaction-local pooling for analytics', async () => {
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env['TEST_DATABASE_URL'], max: 1 }) });
    try {
      expect(await client.salesTransaction.count()).toBe(0);
      const service = new AnalyticsService(new TenantDb(client as PrismaService), app.get(OrganizationAccessService));
      for (const t of [a, b, a]) {
        const data = await service.list({ organizationId: t.organizationId, userId: t.viewerId, role: 'VIEWER' }, 'products', Object.assign(new AnalyticsQueryDto(), query));
        expect(data.total).toBe(t === a ? 3 : 0);
        expect(await client.salesTransaction.count()).toBe(0);
      }
    } finally { await client.$disconnect(); }
  });
});
