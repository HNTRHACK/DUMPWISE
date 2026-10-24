import 'dotenv/config';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// A fresh name and fresh roles each run. No DROP, TRUNCATE, or reuse of existing databases.
const tag = randomBytes(8).toString('hex');
const name = `dumpwise_verify_${tag}_test`;
const adminUrl = new URL(process.env.MIGRATION_DATABASE_URL);
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5000 });
await admin.connect();
try { await admin.query(`CREATE DATABASE "${name}"`); } finally { await admin.end(); }
adminUrl.pathname = `/${name}`;
const app = new URL(adminUrl);
app.username = `dw_app_${tag}`;
app.password = randomBytes(24).toString('hex');
const provisioner = new URL(adminUrl);
provisioner.username = `dw_prov_${tag}`;
provisioner.password = randomBytes(24).toString('hex');
const env = { ...process.env,
  DUMPWISE_DISPOSABLE_DB: name,
  MIGRATION_DATABASE_URL: adminUrl.toString(), TEST_MIGRATION_DATABASE_URL: adminUrl.toString(),
  DATABASE_URL: app.toString(), TEST_DATABASE_URL: app.toString(),
  APP_DB_USER: app.username, APP_DB_PASSWORD: app.password,
  PROVISIONER_DB_USER: provisioner.username, PROVISIONER_DB_PASSWORD: provisioner.password,
  TEST_PROVISIONER_DATABASE_URL: provisioner.toString(), PROVISIONER_DATABASE_URL: provisioner.toString(),
};
function run(args) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Disposable database: ${name} (retained; no automatic deletion)`);
run(['node_modules/@nestjs/cli/bin/nest.js', 'build']);
run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
run(['scripts/setup-db-roles.ts', '--test']);
run(['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.e2e.ts']);
