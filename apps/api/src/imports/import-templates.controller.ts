import { Controller, Get, Post, Body, Param, Query, UploadedFile, UseGuards, UseInterceptors, ParseUUIDPipe, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiTags, ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { OrganizationAccessGuard, CurrentAccess, RequireRoles } from '../auth/organization-access.guard.js';
import type { OrganizationAccess } from '../auth/organization-access.service.js';
import { ListImportsQueryDto } from './imports.dto.js';
import { CreateTemplateDto, TemplateVersionResponseDto, TemplateDetailResponseDto, TemplateListResponseDto, TemplatePreviewResponseDto } from './import-templates.dto.js';
import { ImportTemplatesService } from './import-templates.service.js';

@ApiTags('import-templates')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@UseGuards(OrganizationAccessGuard)
@RequireRoles('OWNER', 'ANALYST')
@Controller('v1/import-templates')
export class ImportTemplatesController {
  constructor(private readonly templates: ImportTemplatesService) {}

  @Post()
  @ApiCreatedResponse({ type: TemplateVersionResponseDto })
  @ApiOperation({ summary: 'Create an immutable draft mapping version (OWNER/ANALYST)' })
  create(@CurrentAccess() ctx: OrganizationAccess, @Body() input: CreateTemplateDto) {
    return this.templates.create(ctx, input);
  }

  @Get()
  @ApiOkResponse({ type: TemplateListResponseDto })
  list(@CurrentAccess() ctx: OrganizationAccess, @Query() q: ListImportsQueryDto) {
    return this.templates.list(ctx, q.limit ?? 20, q.offset ?? 0);
  }

  @Get(':id')
  @ApiOkResponse({ type: TemplateDetailResponseDto })
  get(@CurrentAccess() ctx: OrganizationAccess, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.templates.get(ctx, id);
  }

  @Post(':id/approve')
  @ApiCreatedResponse({ type: TemplateVersionResponseDto })
  @RequireRoles('OWNER')
  @ApiOperation({ summary: 'OWNER explicitly approves mapping and financial interpretation' })
  approve(@CurrentAccess() ctx: OrganizationAccess, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.templates.approve(ctx, id);
  }

  @Post(':id/preview')
  @ApiCreatedResponse({ type: TemplatePreviewResponseDto })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Read-only CSV validation preview; no import or reconciliation claim' })
  preview(@CurrentAccess() ctx: OrganizationAccess, @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('CSV file required');
    return this.templates.preview(ctx, id, file.buffer);
  }
}
