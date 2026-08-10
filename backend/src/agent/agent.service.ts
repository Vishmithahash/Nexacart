import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/exceptions/api.exception';
import { UserRole } from '../generated/prisma/client';
import { CreateAgentRunDto } from './dto/create-agent-run.dto';
import { AgentRunnerService } from './agent-runner.service';

@Injectable()
export class AgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentRunner: AgentRunnerService,
  ) {}

  async startRun(userId: number, role: UserRole, dto: CreateAgentRunDto) {
    if (!dto.instruction || dto.instruction.trim().length === 0) {
      throw ApiException.agentInstructionInvalid(
        'Instruction cannot be blank.',
      );
    }

    return this.agentRunner.runAgent(userId, role, dto.instruction.trim());
  }

  async getRun(userId: number, runId: string) {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        toolCalls: {
          orderBy: { sequenceNumber: 'asc' },
        },
      },
    });

    if (!run || run.userId !== userId) {
      throw ApiException.agentRunNotFound();
    }

    return run;
  }
}
