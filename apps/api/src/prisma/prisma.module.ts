import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { TenantDb } from './tenant-db.service.js';

@Global()
@Module({
  providers: [PrismaService, TenantDb],
  exports: [PrismaService, TenantDb],
})
export class PrismaModule {}
