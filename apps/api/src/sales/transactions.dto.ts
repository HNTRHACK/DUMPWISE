import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { AnalyticsRangeDto } from '../analytics/analytics.dto.js';

export class TransactionsQueryDto extends AnalyticsRangeDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() transactionId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() distributorId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() batchId?: string;
  @ApiPropertyOptional({ enum: ['products', 'distributors', 'customers'] })
  @IsOptional() @IsIn(['products', 'distributors', 'customers']) dimension?: 'products' | 'distributors' | 'customers';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsIn(['asc', 'desc']) direction: 'asc' | 'desc' = 'desc';
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional({ minimum: 0, maximum: 100000, default: 0 })
  @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0;
}

export class TransactionLineageDto {
  @ApiProperty() id: string;
  @ApiProperty() billingDocument: string;
  @ApiProperty() billingItem: string;
  @ApiProperty() billingDate: string;
  @ApiProperty() billingType: string;
  @ApiProperty({ type: String, nullable: true }) cancelledBillingDocument: string | null;
  @ApiProperty() productId: string;
  @ApiProperty() sku: string;
  @ApiProperty() distributorId: string;
  @ApiProperty() distributorCode: string;
  @ApiProperty() customerId: string;
  @ApiProperty() customerCode: string;
  @ApiProperty({ description: 'Exact signed decimal text' }) netAmount: string;
  @ApiProperty() currency: string;
  @ApiProperty({ description: 'Exact signed decimal text' }) quantity: string;
  @ApiProperty() unit: string;
  @ApiProperty() batchId: string;
  @ApiProperty() sourceRowNumber: number;
  @ApiProperty() fileName: string;
  @ApiProperty() fileSha256: string;
  @ApiProperty({ type: String, nullable: true }) templateVersionId: string | null;
  @ApiProperty() rulesVersion: string;
  @ApiProperty({ enum: ['NOT_RETAINED'] }) sourceFileStatus: 'NOT_RETAINED';
}

export class TransactionSubsetDto {
  @ApiProperty() netRevenue: string;
  @ApiProperty() transactionCount: number;
  @ApiProperty({ type: [Object], description: 'Separate unit + exact signed quantity entries' }) units: { unit: string; quantity: string }[];
}
export class TransactionsResponseDto {
  @ApiProperty() organizationId: string;
  @ApiProperty() currency: string;
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty() total: number;
  @ApiProperty() limit: number;
  @ApiProperty() offset: number;
  @ApiProperty({ type: TransactionSubsetDto }) summary: TransactionSubsetDto;
  @ApiProperty({ type: [TransactionLineageDto] }) items: TransactionLineageDto[];
}
