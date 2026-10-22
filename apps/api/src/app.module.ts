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
import { SalesModule } from './sales/sales.module.js';

@Module({
  imports: [
    // Loads .env (real environment variables take precedence) and validates it at startup.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Per-client-IP rate limits, kept in memory (single API instance in this phase).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
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
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
