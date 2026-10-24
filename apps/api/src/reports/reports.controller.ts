import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiProduces, ApiTags, ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentAccess, OrganizationAccessGuard, RequireRoles } from '../auth/organization-access.guard.js';
import type { OrganizationAccess } from '../auth/organization-access.service.js';
import { ListImportsQueryDto } from '../imports/imports.dto.js';
import { CreateReportDto, PilotAssessmentDto, ReportSummaryDto, ReportListDto, ReportPreviewDto } from './reports.dto.js';
import { ReportsService } from './reports.service.js';

@Controller('v1/reports') @ApiTags('reports') @ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@UseGuards(OrganizationAccessGuard) @RequireRoles('OWNER', 'ANALYST')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Post()
  @ApiCreatedResponse({ type: ReportSummaryDto })
  @ApiOperation({ summary: 'Generate immutable private XLSX/PPTX from one published snapshot (max 5000 current+comparison facts)' })
  create(@CurrentAccess() ctx: OrganizationAccess, @Body() q: CreateReportDto) { return this.reports.create(ctx, q); }
  @Get()
  @ApiOkResponse({ type: ReportListDto })
  list(@CurrentAccess() ctx: OrganizationAccess, @Query() q: ListImportsQueryDto) { return this.reports.list(ctx, q.limit ?? 20, q.offset ?? 0); }
  @Get(':id')
  @ApiOkResponse({ type: ReportPreviewDto })
  get(@CurrentAccess() ctx: OrganizationAccess, @Param('id', new ParseUUIDPipe()) id: string) { return this.reports.get(ctx, id); }
  @Post(':id/pilot')
  @ApiOperation({ summary: 'Append user-entered pilot assessment; previous statements remain in history' })
  assess(@CurrentAccess() ctx: OrganizationAccess, @Param('id', new ParseUUIDPipe()) id: string, @Body() input: PilotAssessmentDto) {
    return this.reports.assess(ctx, id, input);
  }
  @Get(':id/pilot')
  assessments(@CurrentAccess() ctx: OrganizationAccess, @Param('id', new ParseUUIDPipe()) id: string, @Query() q: ListImportsQueryDto) {
    return this.reports.assessments(ctx, id, q.limit ?? 20, q.offset ?? 0);
  }
  @Get(':id/xlsx')
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async xlsx(@CurrentAccess() ctx: OrganizationAccess, @Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response) {
    return this.file(ctx, id, 'xlsx', res);
  }
  @Get(':id/pptx')
  @ApiProduces('application/vnd.openxmlformats-officedocument.presentationml.presentation')
  async pptx(@CurrentAccess() ctx: OrganizationAccess, @Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response) {
    return this.file(ctx, id, 'pptx', res);
  }
  private async file(ctx: OrganizationAccess, id: string, format: 'xlsx' | 'pptx', res: Response) {
    const bytes = await this.reports.download(ctx, id, format);
    res.setHeader('Content-Type', format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="DUMPWISE-${id}.${format}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(bytes);
  }
}
