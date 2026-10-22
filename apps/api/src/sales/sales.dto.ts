import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class MonthlySalesQueryDto {
  @ApiPropertyOptional({ example: '2025-10', description: 'First month (inclusive), YYYY-MM' })
  @IsOptional()
  @Matches(MONTH, { message: 'from must be YYYY-MM' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09', description: 'Last month (inclusive), YYYY-MM' })
  @IsOptional()
  @Matches(MONTH, { message: 'to must be YYYY-MM' })
  to?: string;
}

export class UnitsSoldDto {
  @ApiProperty({ example: 'EA' })
  unit: string;

  @ApiProperty({ example: '1520.000', description: 'Signed net units (returns/cancellations subtracted)' })
  quantity: string;
}

export class MonthlySalesRowDto {
  @ApiProperty({ example: '2026-09' })
  month: string;

  @ApiProperty({ example: 'INR' })
  currency: string;

  @ApiProperty({ example: '49445993.81', description: 'Net sales after credit memos, returns and cancellations. Decimal string.' })
  totalNetSales: string;

  @ApiProperty({ example: 192, description: 'Number of billing line items (invoices, credits, returns, cancellations)' })
  transactionCount: number;

  @ApiProperty({ type: [UnitsSoldDto], description: 'Units are reported per sales unit; different units are never added together' })
  unitsSold: UnitsSoldDto[];
}

export class MonthlySalesResponseDto {
  @ApiProperty({ format: 'uuid' })
  organizationId: string;

  @ApiProperty({ enum: ['SYNTHETIC', 'PRODUCTION'] })
  dataClassification: 'SYNTHETIC' | 'PRODUCTION';

  @ApiProperty({ type: [MonthlySalesRowDto] })
  months: MonthlySalesRowDto[];
}
