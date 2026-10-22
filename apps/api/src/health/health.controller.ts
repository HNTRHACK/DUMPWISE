import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { HealthResponseDto } from './health.dto.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOkResponse({ type: HealthResponseDto, description: 'Service and database are up' })
  @ApiServiceUnavailableResponse({ type: HealthResponseDto, description: 'Database unreachable' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponseDto> {
    let database: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    if (database === 'down') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: database === 'up' ? 'ok' : 'error',
      service: 'dumpwise-api',
      timestamp: new Date().toISOString(),
      checks: { database },
    };
  }
}
