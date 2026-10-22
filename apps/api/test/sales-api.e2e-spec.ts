import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ImportPipelineService } from '../src/imports/import-pipeline.service.js';
import { PublicationService } from '../src/imports/publication.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { controlTotals, createTenant, createTestApp, csvOf, loginAs, type Tenant } from './helpers.js';

async function seedPublished(app: INestApplication, t: Tenant, amount: string) {
  const r = await app.get(ImportPipelineService).importBillingCsv({
    organizationId: t.organizationId,
    actorUserId: t.analystId,
    fileName: 'fixture.csv',
    content: csvOf([{ doc: '0090000001', amount, qty: '3' }]),
    controlTotals: controlTotals(
      [{ month: '2026-09', currency: 'INR', netAmount: amount, lineCount: 1 }],
      [{ month: '2026-09', unit: 'EA', quantity: '3.000' }],
    ),
  });
  expect(r.outcome).toBe('IMPORTED');
  await app.get(PublicationService).publish(t.organizationId, r.batchId, t.ownerId);
}

describe('GET /v1/sales/monthly', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let a: Tenant;
  let b: Tenant;
  let tokenA: string; // VIEWER of A
  let ownerTokenA: string; // OWNER of A
  let tokenB: string; // VIEWER of B
  const get = () => request(app.getHttpServer()).get('/v1/sales/monthly');

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    a = await createTenant(prisma);
    b = await createTenant(prisma);
    await seedPublished(app, a, '1111.11');
    await seedPublished(app, b, '2222.22');
    tokenA = (await loginAs(app, a.viewerId)).accessToken;
    ownerTokenA = (await loginAs(app, a.ownerId)).accessToken;
    tokenB = (await loginAs(app, b.viewerId)).accessToken;
  });
  afterAll(async () => {
    await app.close();
  });

  describe('unauthorized access', () => {
    it('401 without a token, with WWW-Authenticate', async () => {
      const res = await get().set('x-organization-id', a.organizationId).expect(401);
      expect(res.headers['www-authenticate']).toBe('Bearer realm="dumpwise"');
      expect(res.body).toMatchObject({ statusCode: 401, message: 'Authentication required' });
    });
    it('401 for a malformed, random or wrong-type token', async () => {
      for (const auth of ['Bearer nope', `Bearer dwa_${'A'.repeat(43)}`, 'Basic dXNlcjpwYXNz', `Bearer dwr_${'A'.repeat(43)}`]) {
        await get().set('authorization', auth).set('x-organization-id', a.organizationId).expect(401);
      }
    });
    it('400 without a valid organization header', async () => {
      await get().auth(tokenA, { type: 'bearer' }).expect(400);
      await get().auth(tokenA, { type: 'bearer' }).set('x-organization-id', 'not-a-uuid').expect(400);
    });
    it('403 for an organization that does not exist', async () => {
      await get().auth(tokenA, { type: 'bearer' }).set('x-organization-id', randomUUID()).expect(403);
    });
    it('400 for invalid or unexpected query parameters', async () => {
      const authed = (r: request.Test) => r.auth(tokenA, { type: 'bearer' }).set('x-organization-id', a.organizationId);
      await authed(get().query({ from: '2026-13' })).expect(400);
      await authed(get().query({ from: '2026-09', to: '2026-01' })).expect(400);
      await authed(get().query({ organizationId: b.organizationId })).expect(400);
    });
  });

  describe('cross-tenant isolation', () => {
    it('a member of A cannot read B (even an OWNER of A)', async () => {
      for (const token of [tokenA, ownerTokenA]) {
        const res = await get().auth(token, { type: 'bearer' }).set('x-organization-id', b.organizationId).expect(403);
        expect(JSON.stringify(res.body)).not.toContain('2222.22');
      }
    });

    it('each organization sees only its own totals', async () => {
      const resA = await get().auth(tokenA, { type: 'bearer' }).set('x-organization-id', a.organizationId).expect(200);
      expect(resA.body).toEqual({
        organizationId: a.organizationId,
        dataClassification: 'SYNTHETIC',
        months: [{ month: '2026-09', currency: 'INR', totalNetSales: '1111.11', transactionCount: 1, unitsSold: [{ unit: 'EA', quantity: '3.000' }] }],
      });
      const resB = await get().auth(tokenB, { type: 'bearer' }).set('x-organization-id', b.organizationId).expect(200);
      expect(resB.body.months[0].totalNetSales).toBe('2222.22');
    });

    it('a user who belongs to both gets each organization separately', async () => {
      await prisma.membership.create({ data: { organizationId: b.organizationId, userId: a.viewerId, role: 'VIEWER' } });
      const resB = await get().auth(tokenA, { type: 'bearer' }).set('x-organization-id', b.organizationId).expect(200);
      expect(resB.body.months[0].totalNetSales).toBe('2222.22');
      const resA = await get().auth(tokenA, { type: 'bearer' }).set('x-organization-id', a.organizationId).expect(200);
      expect(resA.body.months[0].totalNetSales).toBe('1111.11');
    });

    it('the database refuses to link a transaction to another organization\'s product', async () => {
      const batchA = await prisma.importBatch.findFirstOrThrow({ where: { organizationId: a.organizationId } });
      const [distA, custA] = await Promise.all([
        prisma.distributor.findFirstOrThrow({ where: { organizationId: a.organizationId } }),
        prisma.customer.findFirstOrThrow({ where: { organizationId: a.organizationId } }),
      ]);
      const productB = await prisma.product.findFirstOrThrow({ where: { organizationId: b.organizationId } });
      await expect(
        prisma.salesTransaction.create({
          data: {
            organizationId: a.organizationId, importBatchId: batchA.id, distributorId: distA.id, customerId: custA.id,
            productId: productB.id, // belongs to B
            billingDocument: '0090999999', billingItem: '000010', billingType: 'F2', billingDate: new Date('2026-09-01'),
            quantity: '1', salesUnit: 'EA', netAmount: '1.00', currency: 'INR', contentHash: 'x'.repeat(64), sourceRowNumber: 2,
          },
        }),
      ).rejects.toThrow(/foreign key/i);
    });
  });
});
