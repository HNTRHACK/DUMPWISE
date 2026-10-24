// Creates/updates the database roles and grants them the minimum privileges they need.
// Idempotent: safe to run after every migration.
//
//   node scripts/setup-db-roles.ts          (development database)
//   node scripts/setup-db-roles.ts --test   (test database)
//
// Runs with the admin connection (MIGRATION_DATABASE_URL). Never deletes data.
//
// Roles:
//   APP_DB_USER          the API. Row-level security ENFORCED. Cannot create organizations,
//                        users or memberships (so the API credential cannot grant access).
//   PROVISIONER_DB_USER  operator CLI. BYPASSRLS, but privileges ONLY on identity tables:
//                        it can never read or change financial data.
import 'dotenv/config';
import pg from 'pg';

const isTest = process.argv.includes('--test');
const adminUrl = process.env[isTest ? 'TEST_MIGRATION_DATABASE_URL' : 'MIGRATION_DATABASE_URL'];
const roles = {
  app: { user: process.env['APP_DB_USER'], password: process.env['APP_DB_PASSWORD'] },
  provisioner: { user: process.env['PROVISIONER_DB_USER'], password: process.env['PROVISIONER_DB_PASSWORD'] },
};

if (!adminUrl || !roles.app.user || !roles.app.password || !roles.provisioner.user || !roles.provisioner.password) {
  console.error('Missing MIGRATION_DATABASE_URL / APP_DB_USER / APP_DB_PASSWORD / PROVISIONER_DB_USER / PROVISIONER_DB_PASSWORD in .env');
  process.exit(1);
}
for (const r of Object.values(roles)) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(r.user!)) {
    console.error('Role names must be simple lower-case identifiers');
    process.exit(1);
  }
}

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();

async function ensureRole(user: string, password: string, attributes: string): Promise<void> {
  const exists = await client.query('select 1 from pg_roles where rolname = $1', [user]);
  const pw = client.escapeLiteral(password);
  if (exists.rowCount === 0) {
    await client.query(`CREATE ROLE ${user} LOGIN PASSWORD ${pw} ${attributes}`);
    console.log(`created role ${user}`);
  } else {
    await client.query(`ALTER ROLE ${user} WITH LOGIN PASSWORD ${pw} ${attributes}`);
    console.log(`updated role ${user}`);
  }
}

const sql = (s: string) => client.query(s);

try {
  const db = (await client.query<{ db: string }>('select current_database() as db')).rows[0].db;
  const app = roles.app.user!;
  if (app === roles.provisioner.user || app === new URL(adminUrl!).username || roles.provisioner.user === new URL(adminUrl!).username) throw new Error('Database roles must be distinct');
  await sql('BEGIN');
  const prov = roles.provisioner.user!;

  await ensureRole(app, roles.app.password!, 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
  await ensureRole(prov, roles.provisioner.password!, 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS');

  await sql(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
  for (const r of [app, prov]) {
    await sql(`GRANT CONNECT ON DATABASE "${db}" TO ${r}`);
    await sql(`GRANT USAGE ON SCHEMA public TO ${r}`);
    // Start from zero on every run so removed privileges really disappear.
    await sql(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r}`);
    await sql(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${r}`);
  }

  // ---- API runtime role ------------------------------------------------------------------
  await sql(`GRANT SELECT, INSERT, UPDATE ON TABLE users, auth_sessions, user_login_sources, rate_limit_buckets, organizations, memberships, audit_events, import_batches, products, distributors, customers, sales_transactions, reconciliation_results TO ${app}`);
  await sql(`GRANT SELECT, INSERT ON TABLE import_template_versions TO ${app}`);
  await sql(`GRANT UPDATE (status, approved_at, approved_by_user_id) ON TABLE import_template_versions TO ${app}`);
  await sql(`GRANT SELECT, INSERT ON TABLE report_snapshots TO ${app}`);
  await sql(`GRANT SELECT, INSERT ON TABLE pilot_assessments TO ${app}`);
  await sql(`REVOKE ALL ON TABLE _prisma_migrations FROM ${app}`);
  // Authorization data is read-only for the API: it can CHECK access, never GRANT it.
  await sql(`REVOKE INSERT, UPDATE ON TABLE organizations, memberships FROM ${app}`);
  await sql(`REVOKE INSERT ON TABLE users FROM ${app}`); // passwords/lockout fields may be updated
  await sql(`REVOKE UPDATE ON TABLE audit_events FROM ${app}`); // append-only
  await sql(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${app}`);

  // ---- Provisioning role (operator CLI) ----------------------------------------------------
  await sql(`GRANT SELECT, INSERT, UPDATE ON TABLE organizations, users TO ${prov}`);
  await sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE memberships TO ${prov}`);
  await sql(`GRANT SELECT, UPDATE, DELETE ON TABLE auth_sessions TO ${prov}`);
  await sql(`GRANT SELECT, DELETE ON TABLE rate_limit_buckets TO ${prov}`);
  await sql(`GRANT INSERT ON TABLE audit_events TO ${prov}`);
  // Deliberately NO privileges on sales_transactions, import_batches, products, distributors,
  // customers, reconciliation_results: BYPASSRLS gives this role no path to financial data.

  console.log(`granted privileges on "${db}" to ${app} (RLS enforced) and ${prov} (identity tables only)`);
  await sql('COMMIT');
} catch (error) {
  await sql('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
