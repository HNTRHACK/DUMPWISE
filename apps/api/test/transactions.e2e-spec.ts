import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Decimal } from 'decimal.js';
import { createTestApp, createTenant, fixtureDb, loginAs, csvOf, controlTotals, type Tenant } from './helpers.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ImportPipelineService } from '../src/imports/import-pipeline.service.js';
import { PublicationService } from '../src/imports/publication.service.js';

describe('published transaction lineage', () => {
  let app: INestApplication, admin: PrismaService, a: Tenant, b: Tenant, owner: string, viewer: string;
  beforeAll(async () => {
    app = await createTestApp(); admin = fixtureDb(app); a = await createTenant(admin); b = await createTenant(admin);
    owner = (await loginAs(app, a.ownerId)).accessToken; viewer = (await loginAs(app, a.viewerId)).accessToken;
    const rows = [{ doc: '001', amount: '100', qty: '2', unit: 'EA' }, { doc: '002', amount: '10', qty: '5', type: 'G2' },
      { doc: '003', amount: '20', qty: '1', type: 'RE', unit: 'KG' }, { doc: '004', amount: '7', currency: 'USD' }];
    const controls = controlTotals([{ month: '2026-09', currency: 'INR', netAmount: '70', lineCount: 3 },
      { month: '2026-09', currency: 'USD', netAmount: '7', lineCount: 1 }],
      [{ month: '2026-09', unit: 'EA', quantity: '3' }, { month: '2026-09', unit: 'KG', quantity: '-1' }]);
    for (const tenant of [a, b]) {
      const imported = await app.get(ImportPipelineService).importBillingCsv({ organizationId: tenant.organizationId,
        actorUserId: tenant.analystId, fileName: 'SYNTHETIC.csv', content: csvOf(rows), controlTotals: controls });
      await app.get(PublicationService).publish(tenant.organizationId, imported.batchId, tenant.ownerId);
    }
  });
  afterAll(async () => app.close());
  const get = (query = '', token?: string, org?: string) => request(app.getHttpServer())
    .get(`/v1/sales/transactions?from=2026-09&to=2026-09&currency=INR${query}`)
    .set('Authorization', `Bearer ${token ?? owner}`).set('X-Organization-Id', org ?? a.organizationId);

  it('returns exact full-subset totals, leading zeros, source line and honest evidence status', async () => {
    const res = await get().expect(200);
    expect(res.body.summary).toEqual({ netRevenue: '70.00', transactionCount: 3,
      units: [{ unit: 'EA', quantity: '2.000' }, { unit: 'KG', quantity: '-1.000' }] });
    expect(res.body.items[0]).toMatchObject({ billingDocument: '0000000003', billingItem: '000010',
      netAmount: '-20.00', sourceRowNumber: 4, templateVersionId: null,
      rulesVersion: 'sap-billing-signs-v1', sourceFileStatus: 'NOT_RETAINED' });
    expect(res.body.items.reduce((sum: Decimal, r: { netAmount: string }) => sum.plus(r.netAmount), new Decimal(0)).toFixed(2)).toBe(res.body.summary.netRevenue);
  });

  it('has stable pages and filter parity; ignores no currencies or units silently', async () => {
    const pages = [];
    for (let n = 0; n < 3; n++) {
      const r = await get(`&limit=1&offset=${n}&direction=asc`).expect(200);
      expect(r.body.summary.netRevenue).toBe('70.00'); pages.push(r.body.items[0].billingDocument);
    }
    expect(pages).toEqual(['0000000001','0000000002','0000000003']);
    const unit = await get('&unit=EA&dimension=products&search=SYN-MAT').expect(200);
    expect(unit.body.summary.netRevenue).toBe('90.00');
    expect(unit.body.total).toBe(2);
    const foreign = await admin.product.findFirstOrThrow({ where: { organizationId: b.organizationId } });
    expect((await get(`&productId=${foreign.id}`).expect(200)).body.total).toBe(0);
    expect((await get('&dimension=products&search=%27%20OR%201%3D1').expect(200)).body.total).toBe(0);
    await get('&search=anything').expect(400);
    await get('&limit=101').expect(400);
    await get('&sort=netAmount').expect(400);
  });

  it('requires source-detail permission and actual membership, despite identical SAP IDs', async () => {
    await get('', viewer).expect(403);
    await get('', owner, b.organizationId).expect(403);
    await request(app.getHttpServer()).get('/v1/sales/transactions').expect(401);
    const bOwner = (await loginAs(app, b.ownerId)).accessToken;
    const r = await get('', bOwner, b.organizationId).expect(200);
    expect(r.body.summary.netRevenue).toBe('70.00');
    const own = await get().expect(200);
    expect(r.body.items.map((x: { id: string }) => x.id).some((id: string) => own.body.items.some((x: { id: string }) => x.id === id))).toBe(false);
  });
});
