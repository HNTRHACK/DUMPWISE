import { ForbiddenException, Injectable } from '@nestjs/common';
import type { MembershipRole } from '../generated/prisma/client.js';
import { TenantDb } from '../prisma/tenant-db.service.js';

export interface OrganizationAccess {
  userId: string;
  organizationId: string;
  role: MembershipRole;
}

/**
 * Answers "MAY this user act on this organization?" (authorization).
 * Used by the HTTP guard and by services, so every path enforces the same rules.
 */
@Injectable()
export class OrganizationAccessService {
  constructor(private readonly tenantDb: TenantDb) {}

  async require(
    userId: string,
    organizationId: string,
    allowedRoles?: readonly MembershipRole[],
  ): Promise<OrganizationAccess> {
    const membership = await this.tenantDb.run({ organizationId, userId }, (tx) =>
      tx.membership.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: { role: true },
      }),
    );
    // Same answer whether the organization does not exist or the user is not a member,
    // so the response does not reveal which organizations exist.
    if (!membership) throw new ForbiddenException('No access to this organization');
    if (allowedRoles && !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException(`Role ${membership.role} may not perform this action`);
    }
    return { userId, organizationId, role: membership.role };
  }
}
