import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from './prisma.service.js';

export interface TenantContext {
  organizationId?: string | null;
  userId?: string | null;
}

export type TenantTx = Prisma.TransactionClient;

/**
 * Sets the PostgreSQL row-level-security context for the CURRENT TRANSACTION ONLY.
 * set_config(..., true) is transaction-local: it vanishes at COMMIT/ROLLBACK, so a pooled
 * connection can never carry one tenant's context into another request.
 */
export async function setTenantContext(tx: TenantTx, ctx: TenantContext): Promise<void> {
  const org = ctx.organizationId ?? '';
  const user = ctx.userId ?? '';
  // Values are bound as parameters anyway; validating them makes a bad id fail loudly here
  // instead of as a cast error inside a policy.
  if ((org && !isUUID(org)) || (user && !isUUID(user))) throw new Error('Tenant context ids must be UUIDs');
  await tx.$executeRaw`SELECT set_config('app.organization_id', ${org}, true), set_config('app.user_id', ${user}, true)`;
}

/**
 * The ONLY way application code should reach organization-scoped tables. Every call runs in
 * its own transaction with the tenant context set first. Code that bypasses it sees zero rows
 * (row-level security fails closed) rather than another tenant's data.
 */
@Injectable()
export class TenantDb {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(
    ctx: TenantContext,
    fn: (tx: TenantTx) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await setTenantContext(tx, ctx);
      return fn(tx);
    }, options);
  }
}
