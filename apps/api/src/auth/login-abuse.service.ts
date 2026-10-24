import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hitBucket } from '../security/rate-limit-buckets.js';

export const sourceHash = (account: string, ip: string) =>
  createHash('sha256')
    .update(JSON.stringify([account, ip]))
    .digest('hex');

export class LoginAbuseService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private buckets(email: string, ip: string) {
    const cfg = (key: keyof Env) =>
      Number(this.config.get(key, { infer: true }));
    return [
      {
        key: `login:pair:${sourceHash(email, ip)}`,
        limit: cfg('LOGIN_MAX_FAILURES_PER_ACCOUNT_IP'),
        seconds: cfg('LOGIN_ACCOUNT_IP_BLOCK_SECONDS'),
      },
      {
        key: `login:ip:${sourceHash('', ip)}`,
        limit: cfg('LOGIN_MAX_FAILURES_PER_IP'),
        seconds: cfg('LOGIN_IP_BLOCK_SECONDS'),
      },
      {
        key: `login:account:${sourceHash(email, '')}`,
        limit: cfg('LOGIN_MAX_FAILURES_PER_ACCOUNT'),
        seconds: cfg('LOGIN_ACCOUNT_PROTECT_SECONDS'),
      },
    ];
  }

  async blocked(email: string, ip: string, userId?: string): Promise<boolean> {
    const keys = this.buckets(email, ip).map((b) => b.key);
    const active = await this.db.$queryRaw<{ key: string }[]>`
      SELECT key FROM rate_limit_buckets WHERE key IN (${keys[0]}, ${keys[1]}, ${keys[2]}) AND blocked_until > clock_timestamp()`;
    if (active.some((b) => b.key !== keys[2])) return true;
    if (!active.length) return false;
    if (!userId) return true;
    return !(await this.db.userLoginSource.findUnique({
      where: {
        userId_sourceHash: { userId, sourceHash: sourceHash(userId, ip) },
      },
    }));
  }

  async failed(email: string, ip: string): Promise<void> {
    // Stable order avoids deadlocks when failures share an IP or account. UPSERT row locks
    // make increments atomic across processes. Never reset counters on successful login.
    await this.db.$transaction(async (tx) => {
      for (const b of this.buckets(email, ip)) {
        await hitBucket(
          tx,
          b.key,
          b.seconds * 1000,
          b.limit - 1,
          b.seconds * 1000,
        );
      }
    });
  }
}
