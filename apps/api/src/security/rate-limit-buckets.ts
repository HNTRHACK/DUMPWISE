import type { PrismaService } from '../prisma/prisma.service.js';

export interface BucketState {
  hits: number;
  /** Seconds until the counting window ends. */
  timeToExpire: number;
  isBlocked: boolean;
  /** Seconds until the block ends (0 when not blocked). */
  timeToBlockExpire: number;
}

/**
 * Atomically counts one hit in a shared fixed-window bucket (PostgreSQL table
 * rate_limit_buckets) and blocks the key once the count exceeds `limit`.
 *
 * One INSERT ... ON CONFLICT DO UPDATE statement = one round trip, safe under concurrency
 * (the row lock serializes concurrent hits on the same key), shared by every API instance,
 * and timed by the database clock so instances cannot disagree.
 *
 *   - while blocked:              the hit is not counted, the block stays
 *   - window or block has ended:  a fresh window starts with this hit
 *   - otherwise:                  hits + 1; exceeding `limit` starts a block of `blockMs`
 */
export async function hitBucket(
  db: Pick<PrismaService, '$queryRaw'>,
  key: string,
  ttlMs: number,
  limit: number,
  blockMs: number,
): Promise<BucketState> {
  const ttl = Math.max(1, Math.round(ttlMs)) / 1000;
  const block = Math.max(0, Math.round(blockMs)) / 1000;
  const rows = await db.$queryRaw<{ hits: number; expires_in: number; blocked_in: number }[]>`
    INSERT INTO rate_limit_buckets AS b (key, hits, window_expires_at, blocked_until)
    VALUES (
      ${key}, 1, now() + make_interval(secs => ${ttl}::float8),
      CASE WHEN 1 > ${limit}::int AND ${block}::float8 > 0 THEN now() + make_interval(secs => ${block}::float8) END
    )
    ON CONFLICT (key) DO UPDATE SET
      hits = CASE
        WHEN b.blocked_until > now() THEN b.hits
        WHEN b.blocked_until IS NOT NULL OR b.window_expires_at <= now() THEN 1
        ELSE b.hits + 1 END,
      window_expires_at = CASE
        WHEN b.blocked_until > now() THEN b.window_expires_at
        WHEN b.blocked_until IS NOT NULL OR b.window_expires_at <= now() THEN now() + make_interval(secs => ${ttl}::float8)
        ELSE b.window_expires_at END,
      blocked_until = CASE
        WHEN b.blocked_until > now() THEN b.blocked_until
        WHEN b.blocked_until IS NULL AND b.window_expires_at > now()
             AND b.hits + 1 > ${limit}::int AND ${block}::float8 > 0
          THEN now() + make_interval(secs => ${block}::float8)
        ELSE NULL END
    RETURNING hits,
      GREATEST(0, CEIL(EXTRACT(EPOCH FROM (window_expires_at - now()))))::int AS expires_in,
      GREATEST(0, CEIL(EXTRACT(EPOCH FROM (COALESCE(blocked_until, now()) - now()))))::int AS blocked_in`;
  const r = rows[0];
  return { hits: r.hits, timeToExpire: r.expires_in, isBlocked: r.blocked_in > 0, timeToBlockExpire: r.blocked_in };
}
