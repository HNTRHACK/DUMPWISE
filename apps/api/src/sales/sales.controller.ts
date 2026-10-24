import { Controller, Get, Query, UseGuards, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentAccess, OrganizationAccessGuard, RequireRoles } from '../auth/organization-access.guard.js';
import type { OrganizationAccess } from '../auth/organization-access.service.js';
import { MonthlySalesQueryDto, MonthlySalesResponseDto } from './sales.dto.js';
import { SalesService } from './sales.service.js';
import { TransactionsService } from './transactions.service.js';
import { TransactionsQueryDto, TransactionsResponseDto, TransactionLineageDto } from './transactions.dto.js';

@ApiTags('sales')
@Controller('v1/sales')
@UseGuards(OrganizationAccessGuard)
@ApiBearerAuth()
@ApiHeader({ name: 'X-Organization-Id', required: true, description: 'Organization UUID the caller is a member of' })
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked access token' })
@ApiForbiddenResponse({ description: 'Caller is not a member of the organization' })
export class SalesController {
  constructor(private readonly sales: SalesService, private readonly transactions: TransactionsService) {}

  @Get('transactions')
  @RequireRoles('OWNER', 'ANALYST')
  @ApiOperation({ summary: 'Published reconciled source lineage (OWNER/ANALYST); totals cover full filtered subset' })
  @ApiOkResponse({ type: TransactionsResponseDto })
  transactionsList(@CurrentAccess() access: OrganizationAccess, @Query() query: TransactionsQueryDto) {
    return this.transactions.list(access, query);
  }
  @Get('transactions/:id')
  @RequireRoles('OWNER', 'ANALYST')
  @ApiOkResponse({ type: TransactionLineageDto })
  transaction(@CurrentAccess() access: OrganizationAccess, @Param('id', new ParseUUIDPipe()) id: string, @Query() query: TransactionsQueryDto) {
    return this.transactions.get(access, id, query);
  }

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
