// Creates/updates the restricted runtime role used by the API and grants it the minimum
// privileges it needs. Idempotent: safe to run after every migration.
//
//   node scripts/setup-db-roles.ts          (development database)
//   node scripts/setup-db-roles.ts --test   (test database)
//
// Runs with the admin connection (MIGRATION_DATABASE_URL). Never deletes data.
import 'dotenv/config';
import pg from 'pg';

const isTest = process.argv.includes('--test');
const adminUrl = process.env[isTest ? 'TEST_MIGRATION_DATABASE_URL' : 'MIGRATION_DATABASE_URL'];
const appUser = process.env['APP_DB_USER'];
const appPassword = process.env['APP_DB_PASSWORD'];

if (!adminUrl || !appUser || !appPassword) {
  console.error('Missing MIGRATION_DATABASE_URL / APP_DB_USER / APP_DB_PASSWORD in .env');
  process.exit(1);
}
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(appUser)) {
  console.error('APP_DB_USER must be a simple lower-case identifier');
  process.exit(1);
}

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  const db = (await client.query<{ db: string }>('select current_database() as db')).rows[0].db;
  const exists = await client.query('select 1 from pg_roles where rolname = $1', [appUser]);
  const pw = client.escapeLiteral(appPassword);
  if (exists.rowCount === 0) {
    await client.query(`CREATE ROLE ${appUser} LOGIN PASSWORD ${pw} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    console.log(`created role ${appUser}`);
  } else {
    await client.query(`ALTER ROLE ${appUser} WITH LOGIN PASSWORD ${pw} NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    console.log(`updated role ${appUser}`);
  }

  await client.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
  await client.query(`GRANT CONNECT ON DATABASE "${db}" TO ${appUser}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${appUser}`);
  // Read/write business tables, but no DELETE/TRUNCATE and no DDL.
  await client.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${appUser}`);
  await client.query(`REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM ${appUser}`);
  // Audit log is append-only.
  await client.query(`REVOKE UPDATE ON TABLE audit_events FROM ${appUser}`);
  // Prisma's migration bookkeeping is not the API's business.
  await client.query(`REVOKE ALL ON TABLE _prisma_migrations FROM ${appUser}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${appUser}`);
  console.log(`granted runtime privileges on "${db}" to ${appUser}`);
} finally {
  await client.end();
}
