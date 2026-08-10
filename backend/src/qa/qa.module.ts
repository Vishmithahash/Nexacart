import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentModule } from '../agent/agent.module';
import { AgentToolsModule } from '../agent-tools/agent-tools.module';
import { QaScenariosService } from './scenarios/qa-scenarios.service';
import { QaSeedService } from './scenarios/qa-seed.service';
import { QaFixtureService } from './fixtures/qa-fixture.service';
import { QaTemplateResolverService } from './fixtures/qa-template-resolver.service';
import { QaStateSnapshotService } from './state/qa-state-snapshot.service';
import { QaStateAssertionService } from './state/qa-state-assertion.service';
import { ToolCallCorrectnessEvaluator } from './evaluators/tool-call-correctness.evaluator';
import { StateConsistencyEvaluator } from './evaluators/state-consistency.evaluator';
import { QaRunnerService } from './qa-runner.service';
import { QaReportService } from './qa-report.service';
import { QaScenariosController } from './scenarios/qa-scenarios.controller';
import { QaRunsController } from './runs/qa-runs.controller';

@Module({
  imports: [PrismaModule, AgentModule, AgentToolsModule],
  providers: [
    QaScenariosService,
    QaSeedService,
    QaFixtureService,
    QaTemplateResolverService,
    QaStateSnapshotService,
    QaStateAssertionService,
    ToolCallCorrectnessEvaluator,
    StateConsistencyEvaluator,
    QaRunnerService,
    QaReportService,
  ],
  controllers: [QaScenariosController, QaRunsController],
  exports: [
    QaScenariosService,
    QaRunnerService,
    QaReportService,
    ToolCallCorrectnessEvaluator,
    StateConsistencyEvaluator,
  ],
})
export class QaModule {}
