import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import type { Env } from './config/env.js';

/** Global behaviour shared by main.ts and the e2e tests, so tests exercise the real setup. */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  const proxy = app.get<ConfigService<Env, true>>(ConfigService).get('TRUST_PROXY', { infer: true });
  express.set('trust proxy', proxy === 'false' ? false : proxy === 'true' ? true : /^\d+$/.test(proxy) ? Number(proxy) : proxy.split(',').map(s => s.trim()));
  // Security headers: no MIME sniffing, no framing, strict referrer policy, CSP, etc.
  // HSTS and "upgrade-insecure-requests" assume HTTPS; on plain-HTTP localhost they would
  // make browsers fetch assets over https:// and break the page, so they are production-only.
  const production = app.get<ConfigService<Env, true>>(ConfigService).get('NODE_ENV', { infer: true }) === 'production';
  express.use(
    helmet({
      hsts: production,
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: production ? [] : null } },
    }),
  );
  // JSON bodies are small (login, refresh); file uploads use multipart with their own limits.
  express.useBodyParser('json', { limit: '100kb' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties without validation decorators
      forbidNonWhitelisted: true, // ...and reject requests that send them
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('DUMPWISE API')
    .setDescription(
      'Authenticate with POST /v1/auth/login, then send "Authorization: Bearer <accessToken>". ' +
        'Organization-scoped endpoints also require the X-Organization-Id header.',
    )
    .setVersion('0.2.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Opaque access token (dwa_…)' })
    .build();
  return SwaggerModule.createDocument(app, config);
}
