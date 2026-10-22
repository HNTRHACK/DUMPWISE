import {
  BadRequestException,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import { AUTHENTICATOR, type Authenticator } from './authenticator.js';
import { OrganizationAccessService, type OrganizationAccess } from './organization-access.service.js';

export const ORGANIZATION_HEADER = 'x-organization-id';

type RequestWithAccess = Request & { organizationAccess?: OrganizationAccess };

/**
 * Protects organization-scoped routes:
 *   1. authenticate the caller          -> 401 if unknown
 *   2. read X-Organization-Id           -> 400 if missing/invalid
 *   3. check membership in that org     -> 403 if not a member
 * Controllers then receive the verified access via @CurrentAccess() and must use ITS
 * organizationId for every query (never an id taken from the request body).
 */
@Injectable()
export class OrganizationAccessGuard implements CanActivate {
  constructor(
    @Inject(AUTHENTICATOR) private readonly authenticator: Authenticator,
    private readonly access: OrganizationAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithAccess>();
    const principal = await this.authenticator.authenticate(req);
    if (!principal) throw new UnauthorizedException('Authentication required');

    const organizationId = req.header(ORGANIZATION_HEADER);
    if (!organizationId || !isUUID(organizationId)) {
      throw new BadRequestException(`Header ${ORGANIZATION_HEADER} must be a valid UUID`);
    }

    req.organizationAccess = await this.access.require(principal.userId, organizationId);
    return true;
  }
}

export const CurrentAccess = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): OrganizationAccess => {
    const access = ctx.switchToHttp().getRequest<RequestWithAccess>().organizationAccess;
    if (!access) throw new UnauthorizedException('Authentication required');
    return access;
  },
);
