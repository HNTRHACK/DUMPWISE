import {
  BadRequestException,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import type { MembershipRole } from '../generated/prisma/client.js';
import { AUTHENTICATOR, type AuthenticatedPrincipal, type Authenticator } from './authenticator.js';
import { OrganizationAccessService, type OrganizationAccess } from './organization-access.service.js';

export const ORGANIZATION_HEADER = 'x-organization-id';
const ROLES_KEY = 'dumpwise:roles';

type AuthRequest = Request & { principal?: AuthenticatedPrincipal; organizationAccess?: OrganizationAccess };

/** Restricts a route (or controller) to members with one of these roles. */
export const RequireRoles = (...roles: MembershipRole[]) => SetMetadata(ROLES_KEY, roles);

async function authenticate(authenticator: Authenticator, req: AuthRequest): Promise<AuthenticatedPrincipal> {
  const principal = await authenticator.authenticate(req);
  if (!principal) throw new UnauthorizedException('Authentication required');
  req.principal = principal;
  return principal;
}

/** Route needs a logged-in user, but no particular organization (e.g. /v1/auth/me). */
@Injectable()
export class AuthenticatedGuard implements CanActivate {
  constructor(@Inject(AUTHENTICATOR) private readonly authenticator: Authenticator) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await authenticate(this.authenticator, context.switchToHttp().getRequest<AuthRequest>());
    return true;
  }
}

/**
 * Protects organization-scoped routes:
 *   1. authenticate the caller (Bearer token)       -> 401 if unknown/expired/revoked
 *   2. read X-Organization-Id                        -> 400 if missing/invalid
 *   3. check membership (+ @RequireRoles if present) -> 403 if not a member / wrong role
 * Controllers then receive the verified access via @CurrentAccess() and must use ITS
 * organizationId for every query (never an id taken from the request body).
 */
@Injectable()
export class OrganizationAccessGuard implements CanActivate {
  constructor(
    @Inject(AUTHENTICATOR) private readonly authenticator: Authenticator,
    private readonly access: OrganizationAccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const principal = await authenticate(this.authenticator, req);

    const organizationId = req.header(ORGANIZATION_HEADER);
    if (!organizationId || !isUUID(organizationId)) {
      throw new BadRequestException(`Header ${ORGANIZATION_HEADER} must be a valid UUID`);
    }
    const roles = this.reflector.getAllAndOverride<MembershipRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    req.organizationAccess = await this.access.require(principal.userId, organizationId, roles);
    return true;
  }
}

export const CurrentAccess = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): OrganizationAccess => {
    const access = ctx.switchToHttp().getRequest<AuthRequest>().organizationAccess;
    if (!access) throw new UnauthorizedException('Authentication required');
    return access;
  },
);

export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedPrincipal => {
    const principal = ctx.switchToHttp().getRequest<AuthRequest>().principal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    return principal;
  },
);
