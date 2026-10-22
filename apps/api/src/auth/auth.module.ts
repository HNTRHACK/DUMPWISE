import { Global, Module } from '@nestjs/common';
import { AUTHENTICATOR, DisabledAuthenticator } from './authenticator.js';
import { OrganizationAccessGuard } from './organization-access.guard.js';
import { OrganizationAccessService } from './organization-access.service.js';

@Global()
@Module({
  providers: [
    { provide: AUTHENTICATOR, useClass: DisabledAuthenticator },
    OrganizationAccessService,
    OrganizationAccessGuard,
  ],
  exports: [AUTHENTICATOR, OrganizationAccessService, OrganizationAccessGuard],
})
export class AuthModule {}
