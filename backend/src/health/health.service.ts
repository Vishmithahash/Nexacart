import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AppHealthResponse {
  status: string;
  application: string;
}

export interface DatabaseHealthResponse {
  status: string;
  database: string;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  getAppHealth(): AppHealthResponse {
    return {
      status: 'ok',
      application: 'NexaCart API',
    };
  }

  async getDatabaseHealth(): Promise<DatabaseHealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        database: 'connected',
      };
    } catch (error) {
      this.logger.error(
        'Database health check failed — cannot reach PostgreSQL',
      );
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'unavailable',
      });
    }
  }
}
