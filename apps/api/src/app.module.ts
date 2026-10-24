import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module.js';
import { isAuthRateLimited } from './auth/auth-rate-limit.js';
import { AuthModule } from './auth/auth.module.js';
import { validateEnv, type Env } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { ImportsModule } from './imports/imports.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PostgresThrottlerStorage } from './security/postgres-throttler.storage.js';
import { PrismaService } from './prisma/prisma.service.js';
import { SalesModule } from './sales/sales.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';

@Module({
  imports: [
    // Loads .env (real environment variables take precedence) and validates it at startup.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Shared PostgreSQL counters.
    ThrottlerModule.forRootAsync({
      imports: [PrismaModule],
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService<Env, true>, prisma: PrismaService) => ({
        storage: new PostgresThrottlerStorage(prisma),
        throttlers: [
          { name: 'default', ttl: 60_000, limit: config.get('RATE_LIMIT_DEFAULT_PER_MINUTE', { infer: true }) },
          {
            name: 'auth',
            ttl: 60_000,
            limit: config.get('RATE_LIMIT_AUTH_PER_MINUTE', { infer: true }),
            skipIf: (context) => !isAuthRateLimited(context),
          },
        ],
      }),
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    ImportsModule,
    SalesModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
