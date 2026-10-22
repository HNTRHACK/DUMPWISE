import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { validateEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { ImportsModule } from './imports/imports.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SalesModule } from './sales/sales.module.js';

@Module({
  imports: [
    // Loads .env (real environment variables take precedence) and validates it at startup.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuditModule,
    AuthModule,
    ImportsModule,
    SalesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
