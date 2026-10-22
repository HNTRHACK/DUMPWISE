// Prepares the ISOLATED test database before the e2e suite:
// create it if missing -> apply migrations -> apply runtime-role grants -> empty its tables.
// Refuses to run against any database whose name does not end in "_test".
import { execSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

export default async function setup(): Promise<void> {
  loadEnv({ quiet: true });
  const adminUrl = process.env['TEST_MIGRATION_DATABASE_URL'];
  const appUrl = process.env['TEST_DATABASE_URL'];
  if (!adminUrl || !appUrl) throw new Error('TEST_MIGRATION_DATABASE_URL and TEST_DATABASE_URL must be set');

  const dbName = new URL(adminUrl).pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(dbName) || new URL(appUrl).pathname.slice(1) !== dbName) {
    throw new Error(`Refusing to use "${dbName}" for tests: name must end in _test and match TEST_DATABASE_URL`);
  }

  const maintenance = new URL(adminUrl);
  maintenance.pathname = '/postgres';
  maintenance.search = '';
  const admin = new pg.Client({ connectionString: maintenance.toString() });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, MIGRATION_DATABASE_URL: adminUrl },
  });
  execSync('node scripts/setup-db-roles.ts --test', { stdio: 'pipe' });

  const db = new pg.Client({ connectionString: adminUrl });
  await db.connect();
  await db.query(`TRUNCATE audit_events, reconciliation_results, sales_transactions, import_batches,
                  products, distributors, customers, memberships, users, organizations CASCADE`);
  await db.end();
}
