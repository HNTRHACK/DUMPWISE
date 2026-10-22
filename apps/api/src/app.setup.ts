import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

/** Global behaviour shared by main.ts and the e2e tests, so tests exercise the real setup. */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  // No endpoint accepts large JSON bodies in Phase 1; keep the parser limit small.
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
      'Phase 1 API. Only implemented endpoints are documented. Protected endpoints require ' +
        'authentication, which is not yet integrated: they currently return 401 to every caller.',
    )
    .setVersion('0.1.0')
    .build();
  return SwaggerModule.createDocument(app, config);
}
