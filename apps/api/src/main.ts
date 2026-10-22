import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { buildOpenApiDocument, configureApp } from './app.setup.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  const docsEnabled = config.get('ENABLE_API_DOCS', { infer: true }) ?? nodeEnv !== 'production';
  if (docsEnabled) SwaggerModule.setup('docs', app, buildOpenApiDocument(app));

  const host = config.get('HOST', { infer: true });
  const port = config.get('PORT', { infer: true });
  await app.listen(port, host);
  Logger.log(`DUMPWISE API listening on http://${host}:${port}${docsEnabled ? ' (docs at /docs)' : ''}`, 'Bootstrap');
}
await bootstrap();
