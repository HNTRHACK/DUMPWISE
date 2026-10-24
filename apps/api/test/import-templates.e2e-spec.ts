import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, createTenant, fixtureDb, loginAs, csvOf, controlTotals, type Tenant } from './helpers.js';
import { FIELD_SPECS } from '../src/imports/parsing/header-mapping.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TenantDb } from '../src/prisma/tenant-db.service.js';
import { ImportPipelineService } from '../src/imports/import-pipeline.service.js';

describe('configurable imports under real PostgreSQL RLS', () => {
  let app: INestApplication, admin: PrismaService, a: Tenant, b: Tenant;
  let owner: string, analyst: string, viewer: string, id: string, batchId: string;
  const mapping = { columns: Object.entries(FIELD_SPECS).map(([field, spec]) => ({ field, header: spec.aliases[0] })),
    dateFormat: 'DD.MM.YYYY', numberFormat: 'PLAIN', documentTypes: { F2: 'F2', G2: 'G2', RE: 'RE', S1: 'S1' } };
  const source = csvOf([{ doc: '001', amount: '100', qty: '2' }, { doc: '002', amount: '10', qty: '1', type: 'G2' }]);
  const controls = controlTotals([{ month: '2026-09', currency: 'INR', netAmount: '90.00', lineCount: 2 }],
    [{ month: '2026-09', unit: 'EA', quantity: '2.000' }]);
  const call = (method: 'get' | 'post', path: string, token = owner, org?: string) => request(app.getHttpServer())[method](path)
    .set('Authorization', `Bearer ${token}`).set('X-Organization-Id', org ?? a.organizationId);

  beforeAll(async () => {
    app = await createTestApp(); admin = fixtureDb(app);
    a = await createTenant(admin); b = await createTenant(admin);
    owner = (await loginAs(app, a.ownerId)).accessToken;
    analyst = (await loginAs(app, a.analystId)).accessToken;
    viewer = (await loginAs(app, a.viewerId)).accessToken;
  });
  afterAll(async () => app.close());

  it('creates a draft, rejects executable/missing mappings, scopes lists and denies VIEWER', async () => {
    await call('post', '/v1/import-templates', viewer).send({}).expect(403);
    await call('post', '/v1/import-templates').send({ name: 'SYNTHETIC', description: '', version: 1, mapping: { ...mapping, code: 'return 1' } }).expect(400);
    const row = await call('post', '/v1/import-templates', analyst).send({ name: 'SYNTHETIC', description: 'Reviewed net document currency mapping', version: 1, mapping }).expect(201);
    id = row.body.id;
    await call('post', '/v1/import-templates').send({ name: 'SYNTHETIC', description: '', version: 1, mapping }).expect(409);
    const own = await call('get', '/v1/import-templates').expect(200);
    expect(own.body.items.map((r: { id: string }) => r.id)).toContain(id);
    const bToken = (await loginAs(app, b.ownerId)).accessToken;
    await call('get', `/v1/import-templates/${id}`, bToken, b.organizationId).expect(404);
    await call('get', '/v1/import-templates', owner, b.organizationId).expect(403);
  });

  it('previews without writes, blocks draft imports/analyst approval, then OWNER approves', async () => {
    const before = await admin.importBatch.count({ where: { organizationId: a.organizationId } });
    const preview = await call('post', `/v1/import-templates/${id}/preview`, analyst)
      .attach('file', source, 'SYNTHETIC.csv').expect(201);
    expect(preview.body).toMatchObject({ ok: true, reconciliationStatus: 'NOT_RUN', stats: { rowsValid: 2, rowsInvalid: 0 } });
    expect(preview.body.sample[1]).toMatchObject({ netAmount: '-10.00', quantity: '0.000' });
    expect(await admin.importBatch.count({ where: { organizationId: a.organizationId } })).toBe(before);
    await expect(app.get(ImportPipelineService).importBillingCsv({ organizationId: a.organizationId, actorUserId: a.analystId,
      fileName: 'SYNTHETIC.csv', content: source, controlTotals: controls, templateVersionId: id })).rejects.toThrow('not approved');
    await call('post', `/v1/import-templates/${id}/approve`, analyst).expect(403);
    await call('post', `/v1/import-templates/${id}/approve`).expect(201);
    await call('post', `/v1/import-templates/${id}/approve`).expect(201);
  });

  it('imports, reconciles credits, records immutable provenance and preserves upload idempotence', async () => {
    const result = await call('post', '/v1/imports', analyst).field('templateVersionId', id)
      .attach('file', source, 'SYNTHETIC.csv').attach('controlTotals', Buffer.from(JSON.stringify(controls)), 'SYNTHETIC.json').expect(201);
    expect(result.body).toMatchObject({ outcome: 'IMPORTED', stats: { rowsInserted: 2 } });
    batchId = result.body.batchId;
    const batch = await call('get', `/v1/imports/${batchId}`).expect(200);
    expect(batch.body).toMatchObject({ templateVersionId: id, rulesVersion: 'sap-billing-signs-v1', reconciliationStatus: 'PASSED' });
    await call('post', `/v1/imports/${batchId}/publish`).expect(200);
    const again = await call('post', '/v1/imports', analyst).field('templateVersionId', id)
      .attach('file', source, 'SYNTHETIC.csv').attach('controlTotals', Buffer.from(JSON.stringify(controls)), 'SYNTHETIC.json').expect(200);
    expect(again.body).toMatchObject({ outcome: 'ALREADY_IMPORTED', batchId });
    const db = app.get(TenantDb);
    await expect(db.run({ organizationId: a.organizationId }, tx => tx.importTemplateVersion.update({ where: { id }, data: { mapping: {} } }))).rejects.toThrow();
    await expect(db.run({ organizationId: a.organizationId }, tx => tx.importBatch.update({ where: { id: batchId }, data: { templateVersionId: null } }))).rejects.toThrow();
  });

  it('fails closed without context and on pooled A/B/A reads and cross-tenant writes', async () => {
    const runtime = app.get(PrismaService), db = app.get(TenantDb);
    expect(await runtime.importTemplateVersion.findMany()).toEqual([]);
    for (const org of [a.organizationId, b.organizationId, a.organizationId]) {
      const rows = await db.run({ organizationId: org }, tx => tx.importTemplateVersion.findMany());
      expect(rows.every(r => r.organizationId === org)).toBe(true);
      expect(rows.some(r => r.id === id)).toBe(org === a.organizationId);
    }
    await expect(db.run({ organizationId: a.organizationId }, tx => tx.importTemplateVersion.create({ data: {
      organizationId: b.organizationId, name: 'SYNTHETIC', description: '', version: 1, mapping, createdByUserId: a.ownerId,
    } }))).rejects.toThrow();
    expect(await runtime.importTemplateVersion.findMany()).toEqual([]);
  });
});
