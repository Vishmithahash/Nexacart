import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RequestContextModule } from '../common/request-context/request-context.module';
import { LlmModule } from '../llm/llm.module';
import { AgentToolsModule } from '../agent-tools/agent-tools.module';
import { AgentRunnerService } from './agent-runner.service';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';

@Module({
  imports: [PrismaModule, RequestContextModule, LlmModule, AgentToolsModule],
  providers: [AgentRunnerService, AgentService],
  controllers: [AgentController],
  exports: [AgentService, AgentRunnerService],
})
export class AgentModule {}
