import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { TenantDb } from '../src/prisma/tenant-db.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { hitBucket } from '../src/security/rate-limit-buckets.js';
import { spawnSync } from 'node:child_process';

describe('actual PostgreSQL enforcement', () => {
  const a = randomUUID(), b = randomUUID();
  const pool = new pg.Pool({ connectionString: process.env['TEST_DATABASE_URL'], max: 1 });
  const admin = new pg.Client({ connectionString: process.env['TEST_MIGRATION_DATABASE_URL'] });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env['TEST_DATABASE_URL'], max: 1 }) });
  const tenant = new TenantDb(prisma as PrismaService);
  beforeAll(async () => {
    await admin.connect();
    for (const id of [a, b]) {
      await admin.query(`INSERT INTO organizations(id,name,slug,data_classification,updated_at) VALUES($1::uuid,'SYNTHETIC',$1::text,'SYNTHETIC',now())`, [id]);
      await admin.query('INSERT INTO products(organization_id,sku) VALUES($1::uuid,$1::text)', [id]);
    }
  });
  afterAll(async () => { await prisma.$disconnect(); await pool.end(); await admin.end(); });

  it('uses a non-owner, non-superuser, non-bypass runtime role', async () => {
    const r = await pool.query('SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user');
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false });
    const tables = await pool.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('import_batches','products','distributors','customers','sales_transactions','reconciliation_results','organizations','memberships','audit_events')`);
    expect(tables.rows).toHaveLength(9);
    expect(tables.rows.every(r => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
  });

  it('denies missing-context reads/writes and forbids DELETE via privileges', async () => {
    expect((await pool.query('SELECT * FROM products')).rows).toEqual([]);
    await expect(pool.query('INSERT INTO products(organization_id,sku) VALUES($1,\'missing\')', [a])).rejects.toMatchObject({ code: '42501' });
    expect((await pool.query("UPDATE products SET description='bad'")).rowCount).toBe(0);
    await expect(pool.query('DELETE FROM products')).rejects.toMatchObject({ code: '42501' });
  });

  it('filters cross-tenant reads/updates, rejects foreign inserts and tenant reassignment', async () => {
    await tenant.run({ organizationId: a }, async tx => {
      expect((await tx.product.findMany()).map(p => p.organizationId)).toEqual([a]);
      expect(await tx.product.updateMany({ where: { organizationId: b }, data: { description: 'bad' } })).toEqual({ count: 0 });
      await tx.product.create({ data: { organizationId: a, sku: 'allowed' } });
    });
    await expect(tenant.run({ organizationId: a }, tx => tx.product.create({ data: { organizationId: b, sku: 'blocked' } }))).rejects.toThrow();
    await expect(tenant.run({ organizationId: a }, tx => tx.product.updateMany({ where: { sku: 'allowed' }, data: { organizationId: b } }))).rejects.toThrow();
    await expect(tenant.run({ organizationId: a }, tx => tx.$executeRaw`DELETE FROM products WHERE organization_id = ${b}::uuid`)).rejects.toThrow();
  });

  it('clears context after commit and rollback on the same pooled Prisma connection', async () => {
    for (const org of [a, b, a]) {
      await tenant.run({ organizationId: org }, async tx => {
        expect((await tx.product.findMany()).every(p => p.organizationId === org)).toBe(true);
      });
      expect(await prisma.product.count()).toBe(0);
      await expect(tenant.run({ organizationId: org }, async () => { throw new Error('rollback'); })).rejects.toThrow('rollback');
      expect(await prisma.product.count()).toBe(0);
    }
    const results = await Promise.all([a, b].map(organizationId => tenant.run({ organizationId }, tx => tx.product.findMany())));
    expect(results[0].every(p => p.organizationId === a)).toBe(true);
    expect(results[1].every(p => p.organizationId === b)).toBe(true);
  });

  it('does not let runtime credentials grant memberships or create organizations', async () => {
    await expect(pool.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$1,'OWNER')", [a])).rejects.toMatchObject({ code: '42501' });
    await expect(pool.query("UPDATE organizations SET name='bad'")).rejects.toMatchObject({ code: '42501' });
  });

  it('allows identity provisioning but denies financial access to the provisioner', async () => {
    const provisioner = new pg.Client({ connectionString: process.env['TEST_PROVISIONER_DATABASE_URL'] });
    await provisioner.connect();
    try {
      for (const table of ['products', 'sales_transactions', 'import_batches', 'reconciliation_results', 'customers', 'distributors']) {
        await expect(provisioner.query(`SELECT * FROM ${table}`)).rejects.toMatchObject({ code: '42501' });
      }
    } finally { await provisioner.end(); }
    // Exercise the built operator CLI with separate credentials; capture output, including passwords.
    for (const args of [
      ['seed-synthetic'],
      ['create-user', '--email', 'cli-test@example.invalid', '--name', 'SYNTHETIC CLI'],
      ['add-member', '--org', 'synthetic-demo', '--email', 'cli-test@example.invalid', '--role', 'VIEWER'],
      ['reset-password', '--email', 'cli-test@example.invalid'],
      ['monthly', '--org', 'synthetic-demo', '--actor', 'cli-test@example.invalid'],
    ]) {
      const result = spawnSync(process.execPath, ['dist/cli/dumpwise.js', ...args], { env: process.env, encoding: 'utf8' });
      expect(result.status, `CLI ${args[0]} failed`).toBe(0);
    }
  });

  it('shares atomic bucket counts across concurrent calls and independent clients', async () => {
    const key = randomUUID();
    const hits = await Promise.all(Array.from({ length: 6 }, () => hitBucket(prisma as PrismaService, key, 60000, 3, 60000)));
    expect(hits.filter(h => h.isBlocked)).toHaveLength(3);
    const other = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env['TEST_DATABASE_URL'] }) });
    try { expect((await hitBucket(other as PrismaService, key, 60000, 3, 60000)).isBlocked).toBe(true); }
    finally { await other.$disconnect(); }
  });
});
