import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AUTHENTICATOR, BearerSessionAuthenticator } from './authenticator.js';
import { AuthenticatedGuard, OrganizationAccessGuard } from './organization-access.guard.js';
import { OrganizationAccessService } from './organization-access.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    // Swap this binding to change HOW callers are identified (e.g. OIDC later);
    // authorization below stays the same.
    { provide: AUTHENTICATOR, useClass: BearerSessionAuthenticator },
    OrganizationAccessService,
    OrganizationAccessGuard,
    AuthenticatedGuard,
  ],
  exports: [AuthService, AUTHENTICATOR, OrganizationAccessService, OrganizationAccessGuard, AuthenticatedGuard],
})
export class AuthModule {}
