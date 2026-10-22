import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Text fields of the multipart upload (the two files arrive separately via multer). */
export class ImportUploadFieldsDto {
  @IsOptional()
  @IsIn(['PLAIN', 'EN_GROUPED'])
  numberFormat?: 'PLAIN' | 'EN_GROUPED';
}

/** OpenAPI description of the whole multipart body. */
export const IMPORT_UPLOAD_SCHEMA = {
  type: 'object',
  required: ['file', 'controlTotals'],
  properties: {
    file: { type: 'string', format: 'binary', description: 'SAP billing export (CSV, UTF-8)' },
    controlTotals: { type: 'string', format: 'binary', description: 'Control totals JSON (expected monthly totals)' },
    numberFormat: { type: 'string', enum: ['PLAIN', 'EN_GROUPED'], default: 'PLAIN' },
  },
};

export class ListImportsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  offset?: number;
}

export class ImportStatsDto {
  @ApiProperty() rowsTotal: number;
  @ApiProperty() rowsValid: number;
  @ApiProperty() rowsInvalid: number;
  @ApiProperty() rowsDuplicateInFile: number;
  @ApiProperty() rowsAlreadyImported: number;
  @ApiProperty() rowsInserted: number;
}

export class ReconciliationCheckDto {
  @ApiProperty({ enum: ['NET_AMOUNT', 'LINE_COUNT', 'QUANTITY'] }) metric: string;
  @ApiProperty({ example: '2026-09' }) month: string;
  @ApiProperty({ nullable: true, type: String }) currency: string | null;
  @ApiProperty({ nullable: true, type: String }) unit: string | null;
  @ApiProperty({ description: 'Decimal string' }) expected: string;
  @ApiProperty({ description: 'Decimal string' }) actual: string;
  @ApiProperty() passed: boolean;
}

export class ImportIssueDto {
  @ApiProperty({ enum: ['error', 'warning', 'info'] }) severity: string;
  @ApiProperty({ example: 'INVALID_DATE' }) code: string;
  @ApiProperty() message: string;
  @ApiPropertyOptional() line?: number;
  @ApiPropertyOptional() field?: string;
}

export class ImportResultDto {
  @ApiProperty({ enum: ['IMPORTED', 'ALREADY_IMPORTED', 'FAILED_VALIDATION', 'RECONCILIATION_FAILED'] })
  outcome: string;
  @ApiProperty({ format: 'uuid' }) batchId: string;
  @ApiProperty({ enum: ['PROCESSING', 'FAILED_VALIDATION', 'RECONCILIATION_FAILED', 'READY_TO_PUBLISH', 'PUBLISHED'] })
  status: string;
  @ApiProperty({ type: ImportStatsDto }) stats: ImportStatsDto;
  @ApiProperty({ type: [ReconciliationCheckDto] }) reconciliation: ReconciliationCheckDto[];
  @ApiProperty({ type: [ImportIssueDto], description: 'At most 500 issues' }) issues: ImportIssueDto[];
}

export class ImportBatchSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() fileName: string;
  @ApiProperty() fileSha256: string;
  @ApiProperty() fileSizeBytes: number;
  @ApiProperty() isSynthetic: boolean;
  @ApiProperty({ enum: ['PROCESSING', 'FAILED_VALIDATION', 'RECONCILIATION_FAILED', 'READY_TO_PUBLISH', 'PUBLISHED'] })
  status: string;
  @ApiProperty({ enum: ['NOT_RUN', 'PASSED', 'FAILED'] }) reconciliationStatus: string;
  @ApiProperty({ type: ImportStatsDto }) stats: ImportStatsDto;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) createdByUserId: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) publishedAt: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) publishedByUserId: string | null;
}

export class ImportBatchListDto {
  @ApiProperty({ type: [ImportBatchSummaryDto] }) items: ImportBatchSummaryDto[];
  @ApiProperty() total: number;
  @ApiProperty() limit: number;
  @ApiProperty() offset: number;
}

export class ImportBatchDetailDto extends ImportBatchSummaryDto {
  @ApiProperty({ type: [ImportIssueDto] }) issues: ImportIssueDto[];
  @ApiProperty({ type: [ReconciliationCheckDto] }) reconciliation: ReconciliationCheckDto[];
}
