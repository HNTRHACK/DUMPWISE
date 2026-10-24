// Operator-only, one bounded batch per invocation. No financial tables or audit deletion.
import 'dotenv/config';
import pg from 'pg';

const url = process.env['PROVISIONER_DATABASE_URL'];
if (!url) throw new Error('PROVISIONER_DATABASE_URL is required');
const days = Number(process.env['AUTH_CLEANUP_RETENTION_DAYS'] ?? 7);
const batch = Number(process.env['AUTH_CLEANUP_BATCH_SIZE'] ?? 1000);
if (
  !Number.isInteger(days) ||
  days < 1 ||
  days > 365 ||
  !Number.isInteger(batch) ||
  batch < 1 ||
  batch > 10000
) {
  throw new Error(
    'Cleanup retention must be 1..365 days and batch size 1..10000',
  );
}
const db = new pg.Client({ connectionString: url });
try {
  await db.connect();
  const role = (
    await db.query(
      'SELECT current_user AS name, rolsuper FROM pg_roles WHERE rolname=current_user',
    )
  ).rows[0];
  if (role.rolsuper || role.name !== process.env['PROVISIONER_DB_USER'])
    throw new Error(
      'Cleanup requires the configured non-superuser provisioner',
    );
  await db.query('BEGIN');
  await db.query("SET LOCAL statement_timeout = '30s'");
  const sessions = await db.query(
    `WITH stale AS (
    SELECT id FROM auth_sessions
    WHERE expires_at < now() - make_interval(days => $1)
       OR revoked_at < now() - make_interval(days => $1)
    ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED
  ) DELETE FROM auth_sessions s USING stale WHERE s.id = stale.id`,
    [days, batch],
  );
  const buckets = await db.query(
    `WITH stale AS (
    SELECT key FROM rate_limit_buckets
    WHERE window_expires_at < now() AND (blocked_until IS NULL OR blocked_until < now())
    ORDER BY window_expires_at LIMIT $1
  ) DELETE FROM rate_limit_buckets b USING stale WHERE b.key = stale.key
      AND b.window_expires_at < now() AND (b.blocked_until IS NULL OR b.blocked_until < now())`,
    [batch],
  );
  await db.query('COMMIT');
  console.log(
    JSON.stringify({
      sessionsDeleted: sessions.rowCount,
      bucketsDeleted: buckets.rowCount,
    }),
  );
} catch {
  await db.query('ROLLBACK').catch(() => undefined);
  throw new Error(
    'Authentication cleanup failed; verify provisioner configuration and grants',
  );
} finally {
  await db.end();
}
