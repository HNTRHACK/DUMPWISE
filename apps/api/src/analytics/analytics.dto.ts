import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { MonthlySalesResponseDto, UnitsSoldDto } from '../sales/sales.dto.js';

export class AnalyticsRangeDto {
  @ApiProperty({ example: '2026-07' }) @Matches(/^20\d{2}-(0[1-9]|1[0-2])$/) from: string;
  @ApiProperty({ example: '2026-09' }) @Matches(/^20\d{2}-(0[1-9]|1[0-2])$/) to: string;
  @ApiProperty({ example: 'INR' }) @Matches(/^[A-Z]{3}$/) currency: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z0-9]{1,10}$/) unit?: string;
}
export class AnalyticsQueryDto extends AnalyticsRangeDto {
  @ApiPropertyOptional({ description: 'Literal case-insensitive code/name substring' }) @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ enum: ['netRevenue', 'transactionCount', 'code', 'netQuantity'] }) @IsOptional() @IsIn(['netRevenue', 'transactionCount', 'code', 'netQuantity']) sort: string = 'netRevenue';
  @ApiPropertyOptional({ enum: ['asc', 'desc'] }) @IsOptional() @IsIn(['asc', 'desc']) direction: string = 'desc';
  @ApiPropertyOptional({ default: 20, maximum: 100 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number = 20;
  @ApiPropertyOptional({ default: 0, maximum: 100000 }) @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset: number = 0;
}
export class AnalyticsRowDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() code: string;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty() unit: string;
  @ApiProperty() netRevenue: string;
  @ApiProperty({ description: 'Positive magnitude of G2 credits' }) creditedAmount: string;
  @ApiProperty({ description: 'Positive magnitude of RE returns' }) returnedAmount: string;
  @ApiProperty({ description: 'Positive magnitude of S1 cancellations' }) cancelledAmount: string;
  @ApiProperty() netQuantity: string;
  @ApiProperty() transactionCount: number;
  @ApiProperty() previousRevenue: string;
  @ApiProperty({ type: String, nullable: true }) growthPercent: string | null;
  @ApiProperty({ type: String, nullable: true }) growthReason: string | null;
}
export class AnalyticsSummaryDto {
  @ApiProperty() netRevenue: string;
  @ApiProperty() creditedAmount: string;
  @ApiProperty() returnedAmount: string;
  @ApiProperty() cancelledAmount: string;
  @ApiProperty() transactionCount: number;
  @ApiProperty({ type: [UnitsSoldDto] }) units: UnitsSoldDto[];
}
export class AnalyticsResponseDto {
  @ApiProperty({ format: 'uuid' }) organizationId: string;
  @ApiProperty() currency: string;
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty() previousFrom: string;
  @ApiProperty() previousTo: string;
  @ApiProperty({ type: [AnalyticsRowDto] }) items: AnalyticsRowDto[];
  @ApiProperty({ type: AnalyticsSummaryDto }) summary: AnalyticsSummaryDto;
  @ApiProperty() total: number;
  @ApiProperty() limit: number;
  @ApiProperty() offset: number;
}
export class ProductTrendDto extends MonthlySalesResponseDto {
  @ApiProperty({ format: 'uuid' }) productId: string;
}
