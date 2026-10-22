import { Module } from '@nestjs/common';
import { ImportPipelineService } from './import-pipeline.service.js';
import { PublicationService } from './publication.service.js';

// No HTTP controller in Phase 1: imports run through the operator CLI (src/cli) until
// real authentication exists. The services enforce authorization themselves.
@Module({
  providers: [ImportPipelineService, PublicationService],
  exports: [ImportPipelineService, PublicationService],
})
export class ImportsModule {}
