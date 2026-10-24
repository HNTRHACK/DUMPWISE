import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsObject, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ImportIssueDto } from './imports.dto.js';

export class CreateTemplateDto {
  @ApiProperty({ maxLength: 120 })
  @IsString() @MinLength(1) @MaxLength(120) @Matches(/\S/) name: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString() @MaxLength(1000) description: string;

  @ApiProperty({ minimum: 1, maximum: 1000000 })
  @IsInt() @Min(1) @Max(1_000_000) version: number;

  @ApiProperty({ type: Object, description: 'Strict declarative columns [{field,header}], dateFormat, numberFormat and documentTypes. See REPORT_TEMPLATE_SPEC.md.' })
  @IsObject() mapping: Record<string, unknown>;
}

export class TemplateVersionResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) organizationId: string;
  @ApiProperty() name: string;
  @ApiProperty() description: string;
  @ApiProperty({ enum: ['SAP_BILLING_CSV'] }) sourceType: string;
  @ApiProperty() version: number;
  @ApiProperty({ enum: ['DRAFT', 'APPROVED'] }) status: string;
  @ApiProperty({ type: Object }) mapping: object;
  @ApiProperty() rulesVersion: string;
  @ApiProperty({ format: 'uuid' }) createdByUserId: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) approvedByUserId: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) approvedAt: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}
export class TemplateExplanationDto {
  @ApiProperty() field: string;
  @ApiProperty() header: string;
  @ApiProperty() required: boolean;
  @ApiProperty() interpretation: string;
}
export class TemplateDetailResponseDto extends TemplateVersionResponseDto {
  @ApiProperty({ type: [TemplateExplanationDto] }) explanation: TemplateExplanationDto[];
}
export class TemplateListResponseDto {
  @ApiProperty({ type: [TemplateVersionResponseDto] }) items: TemplateVersionResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() limit: number;
  @ApiProperty() offset: number;
}
export class PreviewStatsDto {
  @ApiProperty() rowsTotal: number;
  @ApiProperty() rowsValid: number;
  @ApiProperty() rowsInvalid: number;
  @ApiProperty() rowsDuplicateInFile: number;
}
export class TemplatePreviewResponseDto {
  @ApiProperty() templateVersionId: string;
  @ApiProperty() rulesVersion: string;
  @ApiProperty() status: string;
  @ApiProperty() ok: boolean;
  @ApiProperty({ type: PreviewStatsDto }) stats: PreviewStatsDto;
  @ApiProperty({ type: [ImportIssueDto] }) issues: ImportIssueDto[];
  @ApiProperty() issuesTruncated: boolean;
  @ApiProperty({ type: [TemplateExplanationDto] }) mapping: TemplateExplanationDto[];
  @ApiProperty({ type: [Object], description: 'At most 10 normalized rows; signed amounts/quantities remain exact text' }) sample: object[];
  @ApiProperty({ enum: ['NOT_RUN'] }) reconciliationStatus: string;
  @ApiProperty({ type: [String] }) limitations: string[];
}
