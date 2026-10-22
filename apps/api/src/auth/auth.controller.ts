import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { TenantDb } from '../prisma/tenant-db.service.js';
import { ChangePasswordDto, LoginDto, MeDto, RefreshDto, TokenPairDto } from './auth.dto.js';
import { AuthRateLimited } from './auth-rate-limit.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedPrincipal } from './authenticator.js';
import { AuthenticatedGuard, CurrentPrincipal } from './organization-access.guard.js';

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tenantDb: TenantDb,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @AuthRateLimited()
  @Header('Cache-Control', 'no-store') // tokens must never be cached by browsers or proxies
  @ApiOperation({ summary: 'Log in with e-mail and password; returns a new session' })
  @ApiOkResponse({ type: TokenPairDto })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password (same message for every failure reason)' })
  @ApiTooManyRequestsResponse({ description: 'Too many attempts from this client' })
  login(@Body() dto: LoginDto): Promise<TokenPairDto> {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @AuthRateLimited()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair (the old pair stops working)' })
  @ApiOkResponse({ type: TokenPairDto })
  @ApiUnauthorizedResponse({ description: 'Unknown, expired, revoked or reused refresh token' })
  refresh(@Body() dto: RefreshDto): Promise<TokenPairDto> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthenticatedGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current session immediately' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse()
  async logout(@CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<void> {
    await this.auth.logout(principal);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthenticatedGuard)
  @AuthRateLimited()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change own password; all OTHER sessions are revoked' })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ description: 'Current password is incorrect' })
  async changePassword(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(principal, dto.currentPassword, dto.newPassword);
  }

  @Get('me')
  @UseGuards(AuthenticatedGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user and the organizations they belong to' })
  @ApiOkResponse({ type: MeDto })
  @ApiUnauthorizedResponse()
  async me(@CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<MeDto> {
    // User-only tenant context: row-level security returns exactly this user's memberships.
    const user = await this.tenantDb.run({ userId: principal.userId }, (tx) => tx.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        memberships: {
          select: { role: true, organization: { select: { id: true, name: true, slug: true, dataClassification: true } } },
          orderBy: { organization: { name: 'asc' } },
        },
      },
    }));
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      memberships: user.memberships.map((m) => ({
        organizationId: m.organization.id,
        organizationName: m.organization.name,
        organizationSlug: m.organization.slug,
        dataClassification: m.organization.dataClassification,
        role: m.role,
      })),
    };
  }
}
