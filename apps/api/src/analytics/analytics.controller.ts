import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentAccess, OrganizationAccessGuard } from '../auth/organization-access.guard.js';
import type { OrganizationAccess } from '../auth/organization-access.service.js';
import { AnalyticsRangeDto, AnalyticsQueryDto, AnalyticsResponseDto, ProductTrendDto } from './analytics.dto.js';
import { AnalyticsService } from './analytics.service.js';

@ApiTags('analytics') @ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true })
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@ApiForbiddenResponse({ description: 'No organization membership' })
@ApiBadRequestResponse({ description: 'Invalid month range, currency, unit, filter, sort or pagination' })
@UseGuards(OrganizationAccessGuard) @Controller('v1/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}
  @Get('products') @ApiOkResponse({ type: AnalyticsResponseDto })
  products(@CurrentAccess() a: OrganizationAccess, @Query() q: AnalyticsQueryDto) { return this.analytics.list(a, 'products', q); }
  @Get('distributors') @ApiOkResponse({ type: AnalyticsResponseDto })
  distributors(@CurrentAccess() a: OrganizationAccess, @Query() q: AnalyticsQueryDto) { return this.analytics.list(a, 'distributors', q); }
  @Get('customers') @ApiOkResponse({ type: AnalyticsResponseDto })
  customers(@CurrentAccess() a: OrganizationAccess, @Query() q: AnalyticsQueryDto) { return this.analytics.list(a, 'customers', q); }
  @ApiNotFoundResponse({ description: 'Product not found in the authorized organization' })
  @Get('products/:id/trend') @ApiOkResponse({ type: ProductTrendDto })
  trend(@CurrentAccess() a: OrganizationAccess, @Param('id', ParseUUIDPipe) id: string, @Query() q: AnalyticsRangeDto) { return this.analytics.trend(a, id, q); }
}
