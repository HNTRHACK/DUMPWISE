import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentAccess, OrganizationAccessGuard } from '../auth/organization-access.guard.js';
import type { OrganizationAccess } from '../auth/organization-access.service.js';
import { MonthlySalesQueryDto, MonthlySalesResponseDto } from './sales.dto.js';
import { SalesService } from './sales.service.js';

@ApiTags('sales')
@Controller('v1/sales')
@UseGuards(OrganizationAccessGuard)
@ApiHeader({ name: 'X-Organization-Id', required: true, description: 'Organization UUID the caller is a member of' })
@ApiUnauthorizedResponse({ description: 'Not authenticated. In Phase 1 no identity provider is configured, so all requests receive 401.' })
@ApiForbiddenResponse({ description: 'Caller is not a member of the organization' })
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get('monthly')
  @ApiOperation({ summary: 'Monthly net sales from published, reconciled import batches' })
  @ApiOkResponse({ type: MonthlySalesResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid query or missing X-Organization-Id header' })
  monthly(
    @CurrentAccess() access: OrganizationAccess,
    @Query() query: MonthlySalesQueryDto,
  ): Promise<MonthlySalesResponseDto> {
    return this.sales.monthly(access, query);
  }
}
