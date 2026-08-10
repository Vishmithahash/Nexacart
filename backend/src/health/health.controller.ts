import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type {
  AppHealthResponse,
  DatabaseHealthResponse,
} from './health.service';
import { HealthService } from './health.service';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Application health check',
    description: 'Returns the current status of the NexaCart API application.',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is healthy',
    schema: {
      example: { status: 'ok', application: 'NexaCart API' },
    },
  })
  getAppHealth(): AppHealthResponse {
    return this.healthService.getAppHealth();
  }

  @Public()
  @Get('database')
  @ApiOperation({
    summary: 'Database health check',
    description:
      'Performs a lightweight query to verify PostgreSQL connectivity.',
  })
  @ApiResponse({
    status: 200,
    description: 'Database is reachable',
    schema: {
      example: { status: 'ok', database: 'connected' },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Database is unavailable',
    schema: {
      example: { status: 'error', database: 'unavailable' },
    },
  })
  async getDatabaseHealth(): Promise<DatabaseHealthResponse> {
    return this.healthService.getDatabaseHealth();
  }
}
