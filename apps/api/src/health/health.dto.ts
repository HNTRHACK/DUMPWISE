import { ApiProperty } from '@nestjs/swagger';

export class HealthChecksDto {
  @ApiProperty({ enum: ['up', 'down'] })
  database: 'up' | 'down';
}

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status: 'ok' | 'error';

  @ApiProperty({ example: 'dumpwise-api' })
  service: string;

  @ApiProperty({ example: '2026-10-23T10:00:00.000Z', format: 'date-time' })
  timestamp: string;

  @ApiProperty({ type: HealthChecksDto })
  checks: HealthChecksDto;
}
