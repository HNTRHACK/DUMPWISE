// Real browser -> production Next BFF -> Nest -> restricted PostgreSQL role.
// Source connection is server-enforced READ ONLY. Writes target a fresh disposable DB only.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Preserve SQL DATE as a calendar date, not local midnight converted through UTC.
pg.types.setTypeParser(1082, value => value);

const apiDir = fileURLToPath(new URL('../', import.meta.url));
const webDir = fileURLToPath(new URL('../../web/', import.meta.url));
const tag = randomBytes(8).toString('hex');
const dbName = `dumpwise_live_${tag}_test`;
const sourceUrl = process.env.MIGRATION_DATABASE_URL;
const source = new pg.Client({ connectionString: sourceUrl, connectionTimeoutMillis: 5000 });
const tables = ['organizations','users','memberships','auth_sessions','user_login_sources','rate_limit_buckets','audit_events','import_batches','products','distributors','customers','sales_transactions','reconciliation_results'];
const copyTables = ['organizations','products','distributors','customers','import_batches','sales_transactions','reconciliation_results'];
const children = [];
let target;
const report = { database: dbName, sourceMode: 'READ ONLY', checks: [], totals: [], discrepancies: [] };
const check = label => { report.checks.push(label); console.log(`PASS ${label}`); };

function run(cwd, args, env = process.env) {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  assert.equal(result.status, 0, `Command failed: ${args[0]}`);
}
async function fingerprint(db) {
  const hashes = {};
  for (const table of tables) {
    // Identifiers are the fixed list above, never request input.
    const r = await db.query(`SELECT count(*)::int AS count, md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text),'')) AS hash FROM ${table} t`);
    hashes[table] = r.rows[0];
  }
  return hashes;
}
async function port() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const n = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return n;
}
async function start(cwd, args, env, url) {
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  // Do not print request logs, cookies or authentication responses.
  child.stdout.resume(); child.stderr.resume(); children.push(child);
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error('Isolated service exited before readiness');
    try { if ((await fetch(url)).ok) return; } catch { /* startup in progress */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Isolated service readiness timed out');
}

try {
  await source.connect();
  await source.query('SET default_transaction_read_only = on');
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal((await source.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
  report.sourceBefore = await fingerprint(source);
  const organizations = (await source.query("SELECT * FROM organizations WHERE data_classification='SYNTHETIC' ORDER BY slug")).rows;
  const primary = organizations.find(o => o.slug === 'synthetic-demo');
  const other = organizations.find(o => o.id !== primary?.id);
  assert(primary && other, 'Two existing synthetic organizations are required');
  const ids = organizations.map(o => o.id);
  const snapshot = { organizations };
  for (const table of ['products','distributors','customers']) snapshot[table] = (await source.query(`SELECT * FROM ${table} WHERE organization_id = ANY($1::uuid[])`, [ids])).rows;
  snapshot.import_batches = (await source.query("SELECT * FROM import_batches WHERE organization_id=ANY($1::uuid[]) AND status='PUBLISHED' AND reconciliation_status='PASSED'", [ids])).rows;
  const batchIds = snapshot.import_batches.map(b => b.id);
  for (const table of ['sales_transactions','reconciliation_results']) snapshot[table] = (await source.query(`SELECT * FROM ${table} WHERE organization_id=ANY($1::uuid[]) AND import_batch_id=ANY($2::uuid[])`, [ids, batchIds])).rows;
  assert(snapshot.sales_transactions.length > 0);
  report.snapshot = Object.fromEntries(copyTables.map(t => [t, snapshot[t].length]));
  check('Read-only repeatable snapshot of existing published synthetic data');

  const adminUrl = new URL(sourceUrl); adminUrl.pathname = '/postgres';
  const maintenance = new pg.Client({ connectionString: adminUrl.toString() });
  await maintenance.connect();
  try { await maintenance.query(`CREATE DATABASE "${dbName}"`); } finally { await maintenance.end(); }
  adminUrl.pathname = `/${dbName}`;
  const runtimeUrl = new URL(adminUrl); runtimeUrl.username = `dw_live_${tag}`; runtimeUrl.password = randomBytes(24).toString('hex');
  const provisionerUrl = new URL(adminUrl); provisionerUrl.username = `dw_liveprov_${tag}`; provisionerUrl.password = randomBytes(24).toString('hex');
  const env = { ...process.env, NODE_ENV: 'test', MIGRATION_DATABASE_URL: adminUrl.toString(), TEST_MIGRATION_DATABASE_URL: adminUrl.toString(), DATABASE_URL: runtimeUrl.toString(), APP_DB_USER: runtimeUrl.username, APP_DB_PASSWORD: runtimeUrl.password, PROVISIONER_DB_USER: provisionerUrl.username, PROVISIONER_DB_PASSWORD: provisionerUrl.password, RATE_LIMIT_DEFAULT_PER_MINUTE: '100000' };
  run(apiDir, ['node_modules/@nestjs/cli/bin/nest.js','build'], env);
  run(apiDir, ['node_modules/prisma/build/index.js','migrate','deploy'], env);
  run(apiDir, ['scripts/setup-db-roles.ts','--test'], env);
  target = new pg.Client({ connectionString: adminUrl.toString() }); await target.connect();
  assert.equal((await target.query('SELECT current_database() AS db')).rows[0].db, dbName);
  await target.query('BEGIN');
  for (const table of copyTables) {
    if (snapshot[table].length) await target.query(`INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table}, $1::json)`, [JSON.stringify(snapshot[table])]);
    const actual = (await target.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
    assert.equal(actual, snapshot[table].length);
    const where = table === 'organizations' ? 'id=ANY($1::uuid[])' : ['sales_transactions','reconciliation_results'].includes(table) ? 'organization_id=ANY($1::uuid[]) AND import_batch_id=ANY($2::uuid[])' : table === 'import_batches' ? 'id=ANY($1::uuid[])' : 'organization_id=ANY($1::uuid[])';
    const params = table === 'import_batches' ? [batchIds] : ['sales_transactions','reconciliation_results'].includes(table) ? [ids,batchIds] : [ids];
    const sourceHash = (await source.query(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text),'')) AS hash FROM ${table} t WHERE ${where}`,params)).rows[0].hash;
    const targetHash = (await target.query(`SELECT md5(COALESCE(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text),'')) AS hash FROM ${table} t`)).rows[0].hash;
    assert.equal(targetHash,sourceHash,`Disposable ${table} differs from source snapshot`);
  }
  const { hashPassword } = await import('../dist/auth/password-hasher.js');
  const password = `violet river lantern ${randomBytes(12).toString('hex')}`;
  const hash = await hashPassword(password);
  const accounts = [];
  for (const organization of [primary, other]) {
    const id = randomUUID(), email = `live-${randomBytes(6).toString('hex')}@example.invalid`;
    await target.query('INSERT INTO users(id,email,display_name,password_hash,updated_at) VALUES($1,$2,$3,$4,now())', [id,email,'SYNTHETIC disposable verification',hash]);
    await target.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'VIEWER')", [organization.id,id]);
    accounts.push({ id, email, organizationId: organization.id });
  }
  await target.query('COMMIT');
  check('Disposable copy created; fresh VIEWER identities; no source credentials or sessions copied');
  const runtime = new pg.Client({ connectionString: runtimeUrl.toString() }); await runtime.connect();
  try {
    assert.deepEqual((await runtime.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0], {rolsuper:false,rolbypassrls:false});
    assert.equal((await runtime.query('SELECT count(*)::int AS n FROM sales_transactions')).rows[0].n,0);
  } finally { await runtime.end(); }
  check('Actual restricted role: NOSUPERUSER/NOBYPASSRLS and missing-context SELECT returns zero');
  const apiPort = await port(), webPort = await port();
  const apiBase = `http://127.0.0.1:${apiPort}`, webBase = `http://127.0.0.1:${webPort}`;
  await start(apiDir,['dist/main.js'],{...env,HOST:'127.0.0.1',PORT:String(apiPort)},`${apiBase}/health`);
  run(webDir,['node_modules/next/dist/bin/next','build'],{...process.env,NODE_ENV:'production',DUMPWISE_API_URL:apiBase,DUMPWISE_COOKIE_SECURE:'false'});
  await start(webDir,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(webPort)],{...process.env,NODE_ENV:'production',DUMPWISE_API_URL:apiBase,DUMPWISE_COOKIE_SECURE:'false',DUMPWISE_APP_ORIGIN:webBase},`${webBase}/login`);
  const { verifyPhase4 } = await import('../../web/test/live/phase4-verify.mjs');
  await verifyPhase4({ source, accounts, password, webBase, apiBase, check, report });
  await source.query('COMMIT');
  report.sourceAfter = await fingerprint(source);
  assert.deepEqual(report.sourceAfter, report.sourceBefore, 'Source row counts or fingerprints changed');
  check('Development row counts and fingerprints unchanged across all 13 tables');
  report.ok = true;
} catch (error) {
  report.ok = false;
  // Assertions contain only financial test expectations, never auth secrets.
  report.discrepancies.push({ name: error.name, message: error.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted URL]') });
  console.error('Verification failed:', error.name, error.code ?? 'see safe report');
  process.exitCode = 1;
} finally {
  for (const child of children.reverse()) { child.kill(); }
  await target?.end().catch(() => undefined);
  await source.end().catch(() => undefined);
  report.evidenceHash = createHash('sha256').update(JSON.stringify(report.snapshot ?? {})).digest('hex');
  // Count/fingerprint/financial assertions only; no passwords, bearer tokens or cookies.
  writeFileSync(new URL('../../../docs/phase4-live-evidence.json', import.meta.url), JSON.stringify(report,null,2)+'\n');
  console.log(`Disposable database retained: ${dbName}; ${report.checks.length} checks; success=${report.ok}`);
}
