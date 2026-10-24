import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsString, IsUUID, Matches, MaxLength, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { AnalyticsRangeDto } from '../analytics/analytics.dto.js';

export class CreateReportDto extends AnalyticsRangeDto {
  @ApiProperty({ format: 'uuid', description: 'Retry the same configuration with the same key; a new key captures a new snapshot' })
  @IsUUID() idempotencyKey: string;
}

export class DiscrepancyDto {
  @ApiProperty({ maxLength: 200 }) @IsString() @Matches(/\S/) @MaxLength(200) description: string;
  @ApiProperty({ enum: ['OPEN', 'RESOLVED'] }) @IsIn(['OPEN', 'RESOLVED']) status: 'OPEN' | 'RESOLVED';
}
export class PilotAssessmentDto {
  @ApiProperty({ description: 'Explicitly entered labor minutes; at most 10080, max two decimals' })
  @IsString() @Matches(/^\d{1,5}(\.\d{1,2})?$/) manualMinutes: string;
  @ApiProperty({ description: 'Explicitly entered complete workflow labor minutes, not a server timing estimate' })
  @IsString() @Matches(/^\d{1,5}(\.\d{1,2})?$/) automatedMinutes: string;
  @ApiProperty() @IsBoolean() reviewed: boolean;
  @ApiProperty({ type: [DiscrepancyDto] })
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => DiscrepancyDto) discrepancies: DiscrepancyDto[];
}

export class ReportConfigurationDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty() currency: string;
  @ApiProperty({ type: String, nullable: true }) unit: string | null;
  @ApiProperty() definitionVersion: string;
}
export class ReportSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: ReportConfigurationDto }) configuration: ReportConfigurationDto;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
}
export class ReportListDto {
  @ApiProperty({ type: [ReportSummaryDto] }) items: ReportSummaryDto[];
  @ApiProperty() limit: number;
  @ApiProperty() offset: number;
}
export class ReportPreviewDto extends ReportSummaryDto {
  @ApiProperty({ type: Object, description: 'Exact decimal-string snapshot preview, top 8 entity/unit ranks. Transaction detail collection omitted; use lineage paging or XLSX. See REPORT_EXPORTS.md.' }) snapshot: object;
}
