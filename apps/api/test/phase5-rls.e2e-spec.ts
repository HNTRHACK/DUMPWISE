import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

describe('Phase 5 PostgreSQL authorization through one pooled connection', () => {
  const a = randomUUID(), b = randomUUID(), actor = randomUUID();
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const admin = new pg.Client({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL });
  const tables = ['import_template_versions', 'report_snapshots', 'pilot_assessments'];
  const reports = new Map<string, string>();
  beforeAll(async () => {
    await admin.connect();
    for (const org of [a, b]) {
      await admin.query("INSERT INTO organizations(id,name,slug,data_classification,updated_at) VALUES($1::uuid,'SYNTHETIC RLS fixture',$1::text,'SYNTHETIC',now())", [org]);
      await admin.query("INSERT INTO import_template_versions(organization_id,name,description,version,mapping,created_by_user_id) VALUES($1,'SYNTHETIC','Policy fixture only',1,'{}',$2)", [org, actor]);
      // Minimal private byte fixtures exercise policies only, never downloaded or treated as valid reports.
      const r = await admin.query("INSERT INTO report_snapshots(organization_id,idempotency_key,configuration,snapshot,xlsx,pptx,created_by_user_id,expires_at) VALUES($1,$2,'{}','{}',$3,$3,$4,now()+interval '7 days') RETURNING id", [org, randomUUID(), Buffer.from('SYNTHETIC policy fixture'), actor]);
      reports.set(org, r.rows[0].id);
      await admin.query("INSERT INTO pilot_assessments(organization_id,report_id,manual_minutes,automated_minutes,reviewed,discrepancies,created_by_user_id) VALUES($1,$2,10,5,false,'[]',$3)", [org, reports.get(org), actor]);
    }
  });
  afterAll(async () => { await pool.end(); await admin.end(); });
  async function tenant(org: string, fn: (c: pg.PoolClient) => Promise<void>, rollback = false) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN'); await c.query("SELECT set_config('app.organization_id',$1,true)", [org]);
      await fn(c); await c.query(rollback ? 'ROLLBACK' : 'COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; }
    finally { c.release(); }
  }
  it('denies missing context and restores denial after A/B/A commit/rollback reuse', async () => {
    for (const org of [a, b, a]) {
      for (const table of tables) expect((await pool.query(`SELECT * FROM ${table}`)).rows).toEqual([]);
      await tenant(org, async c => {
        for (const table of tables) {
          const rows = (await c.query(`SELECT organization_id FROM ${table}`)).rows;
          expect(rows).toEqual([{ organization_id: org }]);
          expect((await c.query(`SELECT * FROM ${table} WHERE organization_id=$1`, [org === a ? b : a])).rows).toEqual([]);
        }
      }, org === b);
    }
    for (const table of tables) expect((await pool.query(`SELECT * FROM ${table}`)).rows).toEqual([]);
  });
  it('rejects cross-tenant inserts and forbids update/delete for immutable reports and assessments', async () => {
    await expect(tenant(a, c => c.query("INSERT INTO import_template_versions(organization_id,name,description,version,mapping,created_by_user_id) VALUES($1,'blocked','',1,'{}',$2)", [b, actor]).then(() => {}))).rejects.toMatchObject({ code: '42501' });
    await expect(tenant(a, c => c.query("INSERT INTO report_snapshots(organization_id,idempotency_key,configuration,snapshot,xlsx,pptx,created_by_user_id,expires_at) VALUES($1,$2,'{}','{}',$3,$3,$4,now()+interval '7 days')", [b, randomUUID(), Buffer.from('SYNTHETIC'), actor]).then(() => {}))).rejects.toMatchObject({ code: '42501' });
    await expect(tenant(a, c => c.query("INSERT INTO pilot_assessments(organization_id,report_id,manual_minutes,automated_minutes,reviewed,discrepancies,created_by_user_id) VALUES($1,$2,0,0,false,'[]',$3)", [b, reports.get(b), actor]).then(() => {}))).rejects.toMatchObject({ code: '42501' });
    for (const table of ['report_snapshots','pilot_assessments']) {
      await expect(tenant(a, c => c.query(`UPDATE ${table} SET organization_id=$1`, [b]).then(() => {}))).rejects.toMatchObject({ code: '42501' });
      await expect(tenant(a, c => c.query(`DELETE FROM ${table}`).then(() => {}))).rejects.toMatchObject({ code: '42501' });
    }
    await tenant(a, async c => {
      expect((await c.query("UPDATE import_template_versions SET status='APPROVED',approved_at=now(),approved_by_user_id=$1 WHERE organization_id=$2", [actor,b])).rowCount).toBe(0);
    });
  });
});
