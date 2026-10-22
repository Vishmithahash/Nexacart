import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/exceptions/api.exception';
import { QaScenariosService } from './scenarios/qa-scenarios.service';
import { QaFixtureService } from './fixtures/qa-fixture.service';
import { QaTemplateResolverService } from './fixtures/qa-template-resolver.service';
import { QaStateSnapshotService } from './state/qa-state-snapshot.service';
import { ToolCallCorrectnessEvaluator } from './evaluators/tool-call-correctness.evaluator';
import { StateConsistencyEvaluator } from './evaluators/state-consistency.evaluator';
import { AgentRunnerService } from '../agent/agent-runner.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import {
  QaEvaluationComponent,
  QaRunStatus,
  QaSnapshotPhase,
  UserRole,
  Prisma,
} from '../generated/prisma/client';
import { ExpectedToolPlan } from './evaluators/evaluator.types';
import { ExpectedStateAssertion } from './state/qa-state.types';

@Injectable()
export class QaRunnerService {
  private readonly logger = new Logger(QaRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scenariosService: QaScenariosService,
    private readonly fixtureService: QaFixtureService,
    private readonly templateResolver: QaTemplateResolverService,
    private readonly snapshotService: QaStateSnapshotService,
    private readonly toolEvaluator: ToolCallCorrectnessEvaluator,
    private readonly stateEvaluator: StateConsistencyEvaluator,
    private readonly agentRunner: AgentRunnerService,
    private readonly requestContextService: RequestContextService,
  ) {}

  /**
   * Execute a full research QA run for a scenario code.
   */
  async runScenario(scenarioCode: string) {
    const scenario = await this.scenariosService.getScenarioByCode(scenarioCode);

    // 1. Create QaRun in PREPARING status
    const qaRun = await this.prisma.qaRun.create({
      data: {
        scenarioId: scenario.id,
        scenarioVersion: scenario.version,
        status: QaRunStatus.PREPARING,
        resolvedInstruction: scenario.instructionTemplate,
        fixtureContext: {},
      },
    });

    try {
      // 2. Prepare Fixture
      const fixtureContext = await this.fixtureService.prepareFixture(
        qaRun.id,
        (scenario.fixtureDefinition as Record<string, unknown>) || {},
      );

      // 3. Resolve Instruction Template
      const resolvedInstruction = this.templateResolver.resolveString(
        scenario.instructionTemplate,
        fixtureContext,
      );

      // 4. Capture BEFORE State Snapshot
      const beforeSnapshotContent = await this.snapshotService.captureSnapshot(fixtureContext);
      await this.prisma.qaStateSnapshot.create({
        data: {
          qaRunId: qaRun.id,
          phase: QaSnapshotPhase.BEFORE,
          snapshot: beforeSnapshotContent as unknown as Prisma.InputJsonValue,
        },
      });

      // Update QaRun to RUNNING_AGENT
      await this.prisma.qaRun.update({
        where: { id: qaRun.id },
        data: {
          status: QaRunStatus.RUNNING_AGENT,
          resolvedInstruction,
          fixtureContext: fixtureContext as unknown as Prisma.InputJsonValue,
        },
      });

      // 5. Invoke LLM Agent as Synthetic Customer inside RequestContext overriding qaRunId
      let agentRun: any = null;
      let agentError: string | undefined = undefined;

      try {
        agentRun = await this.requestContextService.runWithOverrides(
          { qaRunId: qaRun.id },
          () =>
            this.agentRunner.runAgent(
              fixtureContext.customerId,
              UserRole.CUSTOMER,
              resolvedInstruction,
            ),
        );
      } catch (err: unknown) {
        agentError = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Agent execution failed during QA run ${qaRun.id}: ${agentError}`);
        const failedAgentRun = (err as any)?.agentRun;
        const failedRunId = (err as any)?.agentRunId ?? failedAgentRun?.id;
        if (failedAgentRun) {
          agentRun = failedAgentRun;
        } else if (failedRunId) {
          agentRun = await this.prisma.agentRun.findUnique({
            where: { id: failedRunId },
            include: {
              toolCalls: { orderBy: { sequenceNumber: 'asc' } },
            },
          });
        }
      }

      // Link AgentRun to QaRun if produced
      if (agentRun) {
        await this.prisma.qaRun.update({
          where: { id: qaRun.id },
          data: {
            agentRunId: agentRun.id,
            provider: agentRun.provider,
            model: agentRun.model,
            systemPromptVersion: agentRun.systemPromptVersion,
          },
        });
      }

      // 6. Capture AFTER State Snapshot (even if AgentRun failed!)
      let afterSnapshotContent: any = null;
      try {
        afterSnapshotContent = await this.snapshotService.captureSnapshot(fixtureContext);
        await this.prisma.qaStateSnapshot.create({
          data: {
            qaRunId: qaRun.id,
            phase: QaSnapshotPhase.AFTER,
            snapshot: afterSnapshotContent as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (snapErr: unknown) {
        this.logger.error(`Failed to capture AFTER snapshot for QA run ${qaRun.id}: ${snapErr}`);
      }

      // Update QaRun to EVALUATING
      await this.prisma.qaRun.update({
        where: { id: qaRun.id },
        data: { status: QaRunStatus.EVALUATING },
      });

      // 7. Component 1: Evaluate Tool-Call Correctness
      const actualToolCalls = agentRun?.toolCalls || [];
      const expectedToolPlan = (scenario.expectedToolPlan as unknown as ExpectedToolPlan) || {
        requiredSteps: [],
      };
      const toolPassThreshold = Number(scenario.toolPassThreshold);

      const component1Result = this.toolEvaluator.evaluate(
        actualToolCalls,
        expectedToolPlan,
        toolPassThreshold,
        fixtureContext,
      );

      await this.prisma.qaEvaluationResult.create({
        data: {
          qaRunId: qaRun.id,
          component: QaEvaluationComponent.TOOL_CALL_CORRECTNESS,
          score: component1Result.overallScore,
          passed: component1Result.passed,
          summary: `Component 1 Score: ${component1Result.overallScore}% (${component1Result.passed ? 'PASS' : 'FAIL'})`,
          details: component1Result as unknown as Prisma.InputJsonValue,
        },
      });

      // 8. Component 2: Evaluate State Consistency
      const expectedAssertions =
        (scenario.expectedStateAssertions as unknown as ExpectedStateAssertion[]) || [];
      const statePassThreshold = Number(scenario.statePassThreshold);

      const component2Result = this.stateEvaluator.evaluate(
        beforeSnapshotContent,
        afterSnapshotContent || beforeSnapshotContent,
        expectedAssertions,
        statePassThreshold,
        fixtureContext,
      );

      await this.prisma.qaEvaluationResult.create({
        data: {
          qaRunId: qaRun.id,
          component: QaEvaluationComponent.STATE_CONSISTENCY,
          score: component2Result.overallScore,
          passed: component2Result.passed,
          summary: `Component 2 Score: ${component2Result.overallScore}% (${component2Result.passed ? 'PASS' : 'FAIL'})`,
          details: component2Result as unknown as Prisma.InputJsonValue,
        },
      });

      // 9. Complete QaRun & Determine overallPassed
      const overallPassed = component1Result.passed && component2Result.passed;

      const completedQaRun = await this.prisma.qaRun.update({
        where: { id: qaRun.id },
        data: {
          status: QaRunStatus.COMPLETED,
          toolCorrectnessScore: component1Result.overallScore,
          stateConsistencyScore: component2Result.overallScore,
          toolPassed: component1Result.passed,
          statePassed: component2Result.passed,
          overallPassed,
          errorMessage: agentError ? `Agent failed: ${agentError}` : undefined,
          completedAt: new Date(),
        },
        include: {
          scenario: true,
          agentRun: { include: { toolCalls: { orderBy: { sequenceNumber: 'asc' } } } },
          snapshots: true,
          evaluations: true,
        },
      });

      return completedQaRun;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`QaRun ${qaRun.id} failed with infrastructure error: ${msg}`);

      await this.prisma.qaRun.update({
        where: { id: qaRun.id },
        data: {
          status: QaRunStatus.FAILED,
          errorCode: (err as any)?.errorCode ?? 'QA_RUN_INFRASTRUCTURE_FAILED',
          errorMessage: msg,
          completedAt: new Date(),
        },
      });

      if (err instanceof ApiException) throw err;
      throw ApiException.qaRunInfrastructureFailed(msg);
    }
  }

  async getRun(runId: string) {
    const run = await this.prisma.qaRun.findUnique({
      where: { id: runId },
      include: {
        scenario: true,
        agentRun: { include: { toolCalls: { orderBy: { sequenceNumber: 'asc' } } } },
        snapshots: true,
        evaluations: true,
      },
    });

    if (!run) {
      throw ApiException.qaRunNotFound(runId);
    }

    return run;
  }
}
