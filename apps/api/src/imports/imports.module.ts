import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Env } from '../config/env.js';
import { ImportBatchesService } from './import-batches.service.js';
import { ImportPipelineService } from './import-pipeline.service.js';
import { ImportsController } from './imports.controller.js';
import { PublicationService } from './publication.service.js';
import { ImportTemplatesService } from './import-templates.service.js';
import { ImportTemplatesController } from './import-templates.controller.js';

@Module({
  imports: [
    // Upload parsing limits are enforced WHILE the request streams in, so an oversized
    // or malformed multipart request is cut off before it fills memory.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        storage: memoryStorage(),
        limits: {
          fileSize: config.get('IMPORT_MAX_BYTES', { infer: true }),
          files: 2,
          fields: 2,
          fieldSize: 1024,
          parts: 4,
          headerPairs: 50,
        },
      }),
    }),
  ],
  controllers: [ImportsController, ImportTemplatesController],
  providers: [ImportPipelineService, PublicationService, ImportBatchesService, ImportTemplatesService],
  exports: [ImportPipelineService, PublicationService, ImportBatchesService],
})
export class ImportsModule {}
