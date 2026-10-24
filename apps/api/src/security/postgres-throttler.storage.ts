import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hitBucket } from './rate-limit-buckets.js';

/**
 * Storage for @nestjs/throttler that keeps counters in PostgreSQL instead of process memory:
 * limits are shared by all API instances and survive restarts. It implements the standard
 * ThrottlerStorage interface, so a Redis implementation can replace it without touching guards.
 */
@Injectable()
export class PostgresThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly prisma: PrismaService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    // The guard already hashes route + client into `key`; add the throttler name so the
    // "default" and "auth" limits on the same route never share a counter.
    const s = await hitBucket(this.prisma, `throttle:${throttlerName}:${key}`, ttl, limit, blockDuration);
    return {
      totalHits: s.hits,
      timeToExpire: s.timeToExpire,
      isBlocked: s.isBlocked,
      timeToBlockExpire: s.timeToBlockExpire,
    };
  }
}
