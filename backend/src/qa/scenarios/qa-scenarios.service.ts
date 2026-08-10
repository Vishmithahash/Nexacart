import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/exceptions/api.exception';

@Injectable()
export class QaScenariosService {
  constructor(private readonly prisma: PrismaService) {}

  async listActiveScenarios() {
    return this.prisma.qaScenario.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  async getScenarioByCode(code: string) {
    const scenario = await this.prisma.qaScenario.findUnique({
      where: { code },
    });

    if (!scenario) {
      throw ApiException.qaScenarioNotFound(code);
    }

    if (!scenario.isActive) {
      throw ApiException.qaScenarioInactive(code);
    }

    return scenario;
  }
}
