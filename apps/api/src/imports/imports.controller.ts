import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentAccess, OrganizationAccessGuard, RequireRoles } from '../auth/organization-access.guard.js';
import type { OrganizationAccess } from '../auth/organization-access.service.js';
import { ImportBatchesService, toSummary } from './import-batches.service.js';
import { ImportPipelineService } from './import-pipeline.service.js';
import {
  ImportBatchDetailDto,
  ImportBatchListDto,
  ImportBatchSummaryDto,
  ImportResultDto,
  IMPORT_UPLOAD_SCHEMA,
  ImportUploadFieldsDto,
  ListImportsQueryDto,
} from './imports.dto.js';
import { PublicationService } from './publication.service.js';

export const CONTROL_TOTALS_MAX_BYTES = 1024 * 1024;

@ApiTags('imports')
@Controller('v1/imports')
@UseGuards(OrganizationAccessGuard)
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true, description: 'Organization UUID the caller is a member of' })
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked access token' })
@ApiForbiddenResponse({ description: 'Not a member, or role not allowed' })
export class ImportsController {
  constructor(
    private readonly pipeline: ImportPipelineService,
    private readonly publication: PublicationService,
    private readonly batches: ImportBatchesService,
  ) {}

  @Post()
  @RequireRoles('OWNER', 'ANALYST')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'file', maxCount: 1 }, { name: 'controlTotals', maxCount: 1 }]))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: IMPORT_UPLOAD_SCHEMA })
  @ApiOperation({
    summary: 'Upload an SAP billing CSV with its control totals and run the import pipeline',
    description:
      '201 when a new batch record was created (check `outcome`: IMPORTED, FAILED_VALIDATION or ' +
      'RECONCILIATION_FAILED). 200 with outcome ALREADY_IMPORTED when this exact file was imported before.',
  })
  @ApiCreatedResponse({ type: ImportResultDto })
  @ApiOkResponse({ type: ImportResultDto, description: 'ALREADY_IMPORTED' })
  @ApiBadRequestResponse({ description: 'Missing file parts, oversized upload, or control totals not valid JSON' })
  async upload(
    @CurrentAccess() access: OrganizationAccess,
    @UploadedFiles() files: { file?: Express.Multer.File[]; controlTotals?: Express.Multer.File[] } | undefined,
    @Body() body: ImportUploadFieldsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ImportResultDto> {
    const file = files?.file?.[0];
    const totals = files?.controlTotals?.[0];
    if (!file || !totals) throw new BadRequestException('Multipart parts "file" and "controlTotals" are both required');
    if (totals.size > CONTROL_TOTALS_MAX_BYTES) throw new BadRequestException('controlTotals must be at most 1 MiB');

    let controlTotals: unknown;
    try {
      controlTotals = JSON.parse(totals.buffer.toString('utf8'));
    } catch {
      throw new BadRequestException('controlTotals is not valid JSON');
    }

    // The existing pipeline does all parsing, validation, de-duplication and reconciliation.
    const result = await this.pipeline.importBillingCsv({
      organizationId: access.organizationId,
      actorUserId: access.userId,
      fileName: file.originalname,
      content: file.buffer,
      controlTotals,
      numberFormat: body.numberFormat,
      templateVersionId: body.templateVersionId,
    });
    if (result.outcome === 'ALREADY_IMPORTED') res.status(HttpStatus.OK);
    res.setHeader('Location', `/v1/imports/${result.batchId}`);
    return result;
  }

  @Get()
  @ApiOperation({ summary: 'List import batches of the organization (newest first)' })
  @ApiOkResponse({ type: ImportBatchListDto })
  list(@CurrentAccess() access: OrganizationAccess, @Query() q: ListImportsQueryDto): Promise<ImportBatchListDto> {
    return this.batches.list(access, q.limit ?? 20, q.offset ?? 0);
  }

  @Get(':batchId')
  @ApiOperation({ summary: 'Batch details with issues and reconciliation checks' })
  @ApiOkResponse({ type: ImportBatchDetailDto })
  @ApiNotFoundResponse({ description: 'No such batch in this organization' })
  get(
    @CurrentAccess() access: OrganizationAccess,
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
  ): Promise<ImportBatchDetailDto> {
    return this.batches.get(access, batchId);
  }

  @Post(':batchId/publish')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('OWNER')
  @ApiOperation({ summary: 'Publish a batch whose reconciliation PASSED (OWNER only)' })
  @ApiOkResponse({ type: ImportBatchSummaryDto })
  @ApiNotFoundResponse({ description: 'No such batch in this organization' })
  @ApiConflictResponse({ description: 'Publication blocked: reconciliation did not pass' })
  async publish(
    @CurrentAccess() access: OrganizationAccess,
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
  ): Promise<ImportBatchSummaryDto> {
    return toSummary(await this.publication.publish(access.organizationId, batchId, access.userId));
  }
}
