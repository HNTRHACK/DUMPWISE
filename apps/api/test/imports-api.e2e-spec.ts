import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { controlTotals, createTenant, createTestApp, csvOf, loadSyntheticDataset, loginAs, type Tenant } from './helpers.js';

describe('Import HTTP API (/v1/imports)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let t: Tenant;
  let other: Tenant;
  const tokens: Record<'owner' | 'analyst' | 'viewer' | 'otherOwner', string> = { owner: '', analyst: '', viewer: '', otherOwner: '' };
  const { csv, control } = loadSyntheticDataset();
  const controlJson = Buffer.from(JSON.stringify(control));

  const as = (token: string, org: string, method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())[method](path).auth(token, { type: 'bearer' }).set('x-organization-id', org);
  const upload = (token: string, org: string, file: Buffer, totals: Buffer, name = 'SYNTHETIC_sap_billing.csv') =>
    as(token, org, 'post', '/v1/imports')
      .attach('file', file, { filename: name, contentType: 'text/csv' })
      .attach('controlTotals', totals, { filename: 'control_totals.json', contentType: 'application/json' });

  let batchId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    t = await createTenant(prisma);
    other = await createTenant(prisma);
    tokens.owner = (await loginAs(app, t.ownerId)).accessToken;
    tokens.analyst = (await loginAs(app, t.analystId)).accessToken;
    tokens.viewer = (await loginAs(app, t.viewerId)).accessToken;
    tokens.otherOwner = (await loginAs(app, other.ownerId)).accessToken;
  });
  afterAll(async () => {
    await app.close();
  });

  describe('upload', () => {
    it('rejects anonymous callers and VIEWERs', async () => {
      await request(app.getHttpServer()).post('/v1/imports').set('x-organization-id', t.organizationId).expect(401);
      await upload(tokens.viewer, t.organizationId, csv, controlJson).expect(403);
    });

    it('ANALYST uploads the synthetic file: same counts and reconciliation as the pipeline', async () => {
      const res = await upload(tokens.analyst, t.organizationId, csv, controlJson).expect(201);
      batchId = res.body.batchId;
      expect(res.headers.location).toBe(`/v1/imports/${batchId}`);
      expect(res.body).toMatchObject({
        outcome: 'IMPORTED',
        status: 'READY_TO_PUBLISH',
        stats: {
          rowsValid: control.expectedIssues.validUniqueRows,
          rowsDuplicateInFile: control.expectedIssues.exactDuplicateRows,
          rowsInvalid: control.expectedIssues.invalidRows + control.expectedIssues.conflictingKeyRows,
          rowsInserted: control.expectedIssues.validUniqueRows,
        },
      });
      expect(res.body.reconciliation.length).toBe(84);
      expect(res.body.reconciliation.every((c: { passed: boolean }) => c.passed)).toBe(true);
      const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
      expect(batch.createdByUserId).toBe(t.analystId);
    });

    it('re-uploading the same file is idempotent (200 ALREADY_IMPORTED)', async () => {
      const res = await upload(tokens.analyst, t.organizationId, csv, controlJson, 'renamed.csv').expect(200);
      expect(res.body).toMatchObject({ outcome: 'ALREADY_IMPORTED', batchId });
    });

    it('rejects missing parts, invalid JSON, unknown fields and extra files', async () => {
      await as(tokens.analyst, t.organizationId, 'post', '/v1/imports').attach('file', csv, 'a.csv').expect(400);
      await upload(tokens.analyst, t.organizationId, csv, Buffer.from('{not json')).expect(400);
      await upload(tokens.analyst, t.organizationId, csv, controlJson).field('numberFormat', 'GERMAN').expect(400);
      await upload(tokens.analyst, t.organizationId, csv, controlJson).field('organizationId', other.organizationId).expect(400);
      await upload(tokens.analyst, t.organizationId, csv, controlJson).attach('extra', csv, 'b.csv').expect(400);
    });

    it('records spreadsheets as FAILED_VALIDATION without opening them', async () => {
      const xlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]);
      const res = await upload(tokens.analyst, t.organizationId, xlsx, controlJson, 'report.xlsx').expect(201);
      expect(res.body.outcome).toBe('FAILED_VALIDATION');
      expect(res.body.issues[0].code).toBe('UNSUPPORTED_FILE_TYPE');
    });
  });

  describe('read', () => {
    it('any member can list and read batches of their organization', async () => {
      const list = await as(tokens.viewer, t.organizationId, 'get', '/v1/imports').expect(200);
      expect(list.body.total).toBeGreaterThanOrEqual(2);
      expect(list.body.items.map((b: { id: string }) => b.id)).toContain(batchId);

      const detail = await as(tokens.viewer, t.organizationId, 'get', `/v1/imports/${batchId}`).expect(200);
      expect(detail.body.reconciliation).toHaveLength(84);
      expect(detail.body.reconciliation[0]).toEqual(
        expect.objectContaining({ month: '2025-10', expected: expect.any(String), actual: expect.any(String), passed: true }),
      );
      expect(detail.body.issues.some((i: { code: string }) => i.code === 'INVALID_DATE')).toBe(true);
    });

    it('never reveals another organization\'s batch', async () => {
      // Correct org header, but the batch id belongs to someone else: 404, not the data.
      await as(tokens.otherOwner, other.organizationId, 'get', `/v1/imports/${batchId}`).expect(404);
      // Asking with the other org's header: not a member -> 403.
      await as(tokens.otherOwner, t.organizationId, 'get', `/v1/imports/${batchId}`).expect(403);
      const list = await as(tokens.otherOwner, other.organizationId, 'get', '/v1/imports').expect(200);
      expect(list.body.total).toBe(0);
    });

    it('validates ids and paging', async () => {
      await as(tokens.viewer, t.organizationId, 'get', '/v1/imports/not-a-uuid').expect(400);
      await as(tokens.viewer, t.organizationId, 'get', `/v1/imports/${randomUUID()}`).expect(404);
      await as(tokens.viewer, t.organizationId, 'get', '/v1/imports?limit=1000').expect(400);
    });
  });

  describe('publish', () => {
    it('only an OWNER may publish; then the data appears in /v1/sales/monthly', async () => {
      const monthly = () => as(tokens.viewer, t.organizationId, 'get', '/v1/sales/monthly');
      expect((await monthly().expect(200)).body.months).toEqual([]);

      await as(tokens.analyst, t.organizationId, 'post', `/v1/imports/${batchId}/publish`).expect(403);
      await as(tokens.otherOwner, other.organizationId, 'post', `/v1/imports/${batchId}/publish`).expect(404);
      const res = await as(tokens.owner, t.organizationId, 'post', `/v1/imports/${batchId}/publish`).expect(200);
      expect(res.body).toMatchObject({ id: batchId, status: 'PUBLISHED', publishedByUserId: t.ownerId });

      const months = (await monthly().expect(200)).body.months as { month: string; currency: string; totalNetSales: string }[];
      for (const c of control.totals) {
        expect(months.find((m) => m.month === c.month && m.currency === c.currency)?.totalNetSales).toBe(c.netAmount);
      }
    });

    it('a batch that failed reconciliation cannot be published (409)', async () => {
      const bad = controlTotals(
        [{ month: '2026-09', currency: 'INR', netAmount: '100.01', lineCount: 1 }],
        [{ month: '2026-09', unit: 'EA', quantity: '1.000' }],
      );
      const res = await upload(tokens.analyst, t.organizationId, csvOf([{ doc: '0091111111', amount: '100.00' }]), Buffer.from(JSON.stringify(bad)), 'small.csv').expect(201);
      expect(res.body.outcome).toBe('RECONCILIATION_FAILED');
      const blocked = await as(tokens.owner, t.organizationId, 'post', `/v1/imports/${res.body.batchId}/publish`).expect(409);
      expect(blocked.body.message).toMatch(/Publication blocked/);
    });
  });
});
